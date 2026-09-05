import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeLoopSnapshot } from '../../src/core/project/loop.js';
import { createChange } from '../../src/core/change/create.js';
import { linkChange } from '../../src/core/project/link.js';
import { archiveChange } from '../../src/core/archive/archive.js';
import { anyCommand, projectCommands, workflowCommands } from '../../src/core/workflows/index.js';
import { renderHarnesses } from '../../src/core/harness/writer.js';
import { allHarnesses } from '../../src/core/harness/registry.js';
import { change, manifest, makePlanWorkspace, seedPlan, withBrief, seedArchivedChange } from '../helpers/plan.js';
import { seedChange, writeFile } from '../helpers/workspace.js';

async function fixture() {
  const workspace = await makePlanWorkspace();
  const changes = await Promise.all([
    change({ id: 'CH-001', slug: 'foundation', priority: 'critical' }),
    change({ id: 'CH-002', slug: 'feature', depends_on: ['CH-001'] }),
    change({ id: 'CH-003', slug: 'independent' }),
  ].map((entry) => withBrief(workspace, 'demo', entry)));
  await seedPlan(workspace, manifest({ changes }));
  return { workspace, changes };
}

describe('autonomous loop frontier', () => {
  it('exposes all independent choices without writing or treating a waiting dependency as completion', async () => {
    const { workspace } = await fixture();
    const file = path.join(workspace.projectRoot, 'planning/demo/plan.yaml');
    const before = await fs.readFile(file, 'utf8');
    const snapshot = await computeLoopSnapshot(workspace, 'demo');
    expect(snapshot).toMatchObject({ loopSchemaVersion: 1, state: 'ready', recommended: 'CH-001' });
    expect(snapshot.candidates.map((entry) => [entry.id, entry.action])).toEqual([
      ['CH-001', 'propose'], ['CH-003', 'propose'],
    ]);
    expect(snapshot.blockers[0]).toMatchObject({ id: 'CH-002', blockedBy: ['CH-001'] });
    expect(snapshot.remaining).toHaveLength(3);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(await fs.readdir(workspace.changesPath)).toEqual(['archive']);
  });

  it('resumes partial artifacts, implements pending tasks, then requires verify before dependencies unlock', async () => {
    const { workspace } = await fixture();
    await createChange(workspace, 'foundation');
    expect((await computeLoopSnapshot(workspace, 'demo')).candidates[0].action).toBe('link');
    await linkChange(workspace, 'demo', 'CH-001', 'foundation');
    expect((await computeLoopSnapshot(workspace, 'demo')).candidates[0].action).toBe('continue');
    const dir = await seedChange(workspace, 'foundation');
    expect((await computeLoopSnapshot(workspace, 'demo')).candidates[0].action).toBe('implement');
    await writeFile(path.join(dir, 'tasks.md'), '## Work\n- [x] 1.1 Verified implementation\n');
    const verify = await computeLoopSnapshot(workspace, 'demo');
    expect(verify.candidates[0].action).toBe('verify');
    expect(verify.completed).toEqual([]);
    expect(verify.candidates.map((entry) => entry.id)).not.toContain('CH-002');
    await archiveChange(workspace, 'foundation');
    const after = await computeLoopSnapshot(workspace, 'demo');
    expect(after.completed).toEqual(['CH-001']);
    expect(after.candidates.map((entry) => entry.id)).toEqual(['CH-002', 'CH-003']);
  });

  it('reconciles an existing archive without proposing duplicate work', async () => {
    const { workspace } = await fixture();
    await seedArchivedChange(workspace, 'foundation');
    expect((await computeLoopSnapshot(workspace, 'demo')).candidates[0].action).toBe('link');
    await linkChange(workspace, 'demo', 'CH-001', 'foundation');
    expect((await computeLoopSnapshot(workspace, 'demo')).completed).toEqual(['CH-001']);
  });

  it('completes only after every non-cancelled node is archived', async () => {
    const { workspace, changes } = await fixture();
    for (const entry of changes.slice(0, 2)) {
      await seedArchivedChange(workspace, entry.slug);
      entry.link = { name: entry.slug, active_path: null, archive_path: null, linked_at: '2026-09-01' };
    }
    changes[2].planning_state = 'cancelled';
    await seedPlan(workspace, manifest({ changes }));
    expect(await computeLoopSnapshot(workspace, 'demo')).toMatchObject({
      state: 'completed', completed: ['CH-001', 'CH-002'], cancelled: ['CH-003'], remaining: [], candidates: [],
    });
  });

  it.each(['draft', 'reviewing', 'paused', 'archived'] as const)('does not execute a %s plan', async (status) => {
    const { workspace, changes } = await fixture();
    await seedPlan(workspace, manifest({ status, changes }));
    expect(await computeLoopSnapshot(workspace, 'demo')).toMatchObject({
      state: 'blocked', candidates: [], blockers: expect.arrayContaining([
        expect.objectContaining({ id: null, reasonCodes: [`plan_${status}`] }),
      ]),
    });
  });

  it('keeps ideas, holds and manual blockers pending while continuing independent work', async () => {
    const { workspace, changes } = await fixture();
    changes[0].manual_blockers = ['External API unavailable'];
    changes[1].planning_state = 'on_hold';
    await seedPlan(workspace, manifest({ changes }));
    const snapshot = await computeLoopSnapshot(workspace, 'demo');
    expect(snapshot.state).toBe('ready');
    expect(snapshot.candidates.map((entry) => entry.id)).toEqual(['CH-003']);
    expect(snapshot.blockers).toContainEqual(expect.objectContaining({ manualBlockers: ['External API unavailable'] }));
    changes[2].planning_state = 'idea';
    await seedPlan(workspace, manifest({ changes }));
    expect(await computeLoopSnapshot(workspace, 'demo')).toMatchObject({ state: 'blocked', remaining: ['CH-001', 'CH-002', 'CH-003'] });
  });

  it('does not declare an empty plan complete', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest());
    expect(await computeLoopSnapshot(workspace, 'demo')).toMatchObject({ state: 'blocked', blockers: [
      expect.objectContaining({ reasonCodes: ['empty_plan'] }),
    ] });
  });

  it('refuses an ambiguous active/archive identity', async () => {
    const { workspace } = await fixture();
    await seedChange(workspace, 'foundation');
    await seedArchivedChange(workspace, 'foundation');
    await linkChange(workspace, 'demo', 'CH-001', 'foundation');
    const snapshot = await computeLoopSnapshot(workspace, 'demo');
    expect(snapshot.completed).not.toContain('CH-001');
    expect(snapshot.candidates.map((entry) => entry.id)).not.toContain('CH-001');
    expect(snapshot.candidates.map((entry) => entry.id)).not.toContain('CH-002');
    expect(snapshot.blockers).toContainEqual(expect.objectContaining({ id: 'CH-001', reasonCodes: ['ambiguous_execution'] }));
  });

  it('reports broken native metadata without abandoning independent nodes', async () => {
    const { workspace } = await fixture();
    await seedChange(workspace, 'foundation');
    await linkChange(workspace, 'demo', 'CH-001', 'foundation');
    await writeFile(path.join(workspace.changesPath, 'foundation/.change.yaml'), 'schema: [invalid\n');
    const snapshot = await computeLoopSnapshot(workspace, 'demo');
    expect(snapshot.candidates.map((entry) => entry.id)).toEqual(['CH-003']);
    expect(snapshot.blockers).toContainEqual(expect.objectContaining({ id: 'CH-001', reasonCodes: ['invalid_change_metadata'] }));
  });

  it('does not dispatch or complete a change with a leftover worktree registry', async () => {
    const { workspace } = await fixture();
    await seedChange(workspace, 'foundation');
    await linkChange(workspace, 'demo', 'CH-001', 'foundation');
    const registry = path.join(workspace.projectRoot, '.specwright/parallel/foundation/change.json');
    await writeFile(registry, '{}');
    const active = await computeLoopSnapshot(workspace, 'demo');
    expect(active.candidates.map((entry) => entry.id)).toEqual(['CH-003']);
    expect(active.blockers).toContainEqual(expect.objectContaining({ id: 'CH-001', reasonCodes: ['worktree_active'] }));
    await fs.rm(path.join(workspace.changesPath, 'foundation'), { recursive: true });
    await seedArchivedChange(workspace, 'foundation');
    const archived = await computeLoopSnapshot(workspace, 'demo');
    expect(archived.completed).not.toContain('CH-001');
    expect(archived.candidates.map((entry) => entry.id)).toEqual(['CH-003']);
    expect(await fs.readFile(registry, 'utf8')).toBe('{}');
  });

  it('keeps a modified brief out of execution without overwriting it', async () => {
    const { workspace, changes } = await fixture();
    const brief = path.join(workspace.projectRoot, 'planning/demo', changes[0].planned_change!.path);
    await fs.appendFile(brief, '\nHuman decision awaiting reconciliation.\n');
    const before = await fs.readFile(brief, 'utf8');
    const snapshot = await computeLoopSnapshot(workspace, 'demo');
    expect(snapshot.candidates.map((entry) => entry.id)).toEqual(['CH-003']);
    expect(snapshot.blockers.find((entry) => entry.id === 'CH-001')!.reasonCodes).toContain('planned_change_modified');
    expect(await fs.readFile(brief, 'utf8')).toBe(before);
  });

  it('rejects a cyclic graph rather than presenting it as completed', async () => {
    const { workspace, changes } = await fixture();
    changes[0].depends_on = ['CH-002'];
    await seedPlan(workspace, manifest({ changes }));
    await expect(computeLoopSnapshot(workspace, 'demo')).rejects.toMatchObject({ code: 'dependency_cycle' });
  });
});

describe('explicit loop workflow', () => {
  it('keeps the normal change cycle and macro planning boundaries separate', () => {
    expect(workflowCommands().map((entry) => entry.id)).not.toContain('loop');
    expect(projectCommands().map((entry) => entry.id)).not.toContain('loop');
    const loop = anyCommand('loop')!;
    expect(loop.description).toContain('Somente por pedido explícito');
    expect(loop.body).toContain('NÃO ativa o loop');
    expect(loop.body).toContain('corrigir falhas dentro do escopo');
    expect(loop.body).toContain('não repita indefinidamente');
    expect(loop.body).toContain('não peça aprovação a cada fase');
    expect(loop.body).toContain('Workers nunca arquivam');
    expect(loop.body).not.toContain('trabalha o PLANO do projeto, nunca uma change');
  });

  it('generates the explicit mode in every harness with portable references', () => {
    const files = renderHarnesses(allHarnesses()).filter((entry) => entry.command === 'loop');
    expect(files).toHaveLength(4);
    for (const file of files) {
      expect(file.content).not.toContain('{{spec-command:');
      expect(file.content).toContain('specs project loop <plan-id> --json');
      expect(file.content).toContain(file.harness === 'codex' ? '$spec-loop' : '/spec-loop');
    }
    expect(files.find((entry) => entry.harness === 'claude')!.content).toContain('allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task');
  });
});
