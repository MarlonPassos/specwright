import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generatePlannedChanges } from '../../src/core/project/generate.js';
import { computeProjectStatus } from '../../src/core/project/status.js';
import { sha256 } from '../../src/core/project/hashes.js';
import { makePlanWorkspace, seedPlan, manifest, change } from '../helpers/plan.js';
import { writeFile } from '../helpers/workspace.js';
import type { Workspace } from '../../src/core/workspace.js';

async function planWithSource(): Promise<Workspace> {
  const workspace = await makePlanWorkspace();
  await writeFile(path.join(workspace.projectRoot, 'docs/v.md'), '# vision\n');
  return workspace;
}

describe('generatePlannedChanges', () => {
  it('materializes a missing brief and records path, revision and hashes (AC-10)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        revision: 3,
        changes: [change({ id: 'CH-002', slug: 'auth', title: 'Auth' })],
      })
    );

    const result = await generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-002'] });
    expect(result.generated).toBe(true);
    expect(result.revision).toEqual({ from: 3, to: 4 });
    expect(result.written).toContain('planning/demo/planned-changes/CH-002-auth.md');

    const status = await computeProjectStatus(workspace, 'demo');
    const ref = status.changes[0].plannedChange!;
    expect(ref.path).toBe('planned-changes/CH-002-auth.md');
    expect(ref.generatedFromPlanRevision).toBe(4);
  });

  it('is idempotent: a second run skips with planned_change_current and writes nothing (AC-11)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'x' })] }));
    await generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-001'] });

    const manifestBytes = await fs.readFile(
      path.join(workspace.projectRoot, 'planning/demo/plan.yaml'),
      'utf8'
    );
    const again = await generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-001'] });
    expect(again.skipped).toEqual([{ id: 'CH-001', reason: 'planned_change_current' }]);
    expect(again.written).toEqual([]);
    expect(
      await fs.readFile(path.join(workspace.projectRoot, 'planning/demo/plan.yaml'), 'utf8')
    ).toBe(manifestBytes);
  });

  it('--dry-run writes nothing and leaves every planning file untouched (AC-16)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'x' })] }));

    const before = await fs.readFile(
      path.join(workspace.projectRoot, 'planning/demo/plan.yaml'),
      'utf8'
    );
    const result = await generatePlannedChanges(workspace, 'demo', {
      changeIds: ['CH-001'],
      dryRun: true,
    });
    expect(result.generated).toBe(false);
    expect(result.written.length).toBe(1);
    expect(
      await fs.readFile(path.join(workspace.projectRoot, 'planning/demo/plan.yaml'), 'utf8')
    ).toBe(before);
    await expect(
      fs.stat(path.join(workspace.projectRoot, 'planning/demo/planned-changes/CH-001-x.md'))
    ).rejects.toThrow();
  });

  it('refuses to overwrite a hand-edited brief, without --force (AC-13)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'x' })] }));
    await generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-001'] });

    const briefPath = path.join(workspace.projectRoot, 'planning/demo/planned-changes/CH-001-x.md');
    await fs.appendFile(briefPath, '\n\n# Extra\n\nedição humana\n');

    const result = await generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-001'] });
    expect(result.generated).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].state).toBe('modified');
    expect(result.conflicts[0].recordedContentHash).not.toBe(result.conflicts[0].currentContentHash);
    expect((await fs.readFile(briefPath, 'utf8')).includes('edição humana')).toBe(true);
  });

  it('--force adopts the hand-edited content and refreshes the hashes (AC-14)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'x' })] }));
    await generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-001'] });

    const briefPath = path.join(workspace.projectRoot, 'planning/demo/planned-changes/CH-001-x.md');
    await fs.appendFile(briefPath, '\n\n# Extra\n\nedição humana\n');
    const edited = await fs.readFile(briefPath, 'utf8');

    const result = await generatePlannedChanges(workspace, 'demo', {
      changeIds: ['CH-001'],
      force: true,
    });
    expect(result.generated).toBe(true);
    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.changes[0].plannedChange!.state).toBe('current');
    expect(await fs.readFile(briefPath, 'utf8')).toBe(edited);
  });

  it('marks a brief outdated when a relevant record field changes (title / depends_on)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({ id: 'CH-001', slug: 'a' }),
          change({ id: 'CH-002', slug: 'b', title: 'Antigo' }),
        ],
      })
    );
    await generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-002'] });
    expect((await computeProjectStatus(workspace, 'demo')).changes.find((c) => c.id === 'CH-002')!.plannedChange!.state).toBe('current');

    // change the title on disk without regenerating
    const yaml = path.join(workspace.projectRoot, 'planning/demo/plan.yaml');
    await fs.writeFile(yaml, (await fs.readFile(yaml, 'utf8')).replace('title: Antigo', 'title: Novo'));
    expect((await computeProjectStatus(workspace, 'demo')).changes.find((c) => c.id === 'CH-002')!.plannedChange!.state).toBe('outdated');

    // regenerating refreshes record_hash → current again
    await generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-002'] });
    expect((await computeProjectStatus(workspace, 'demo')).changes.find((c) => c.id === 'CH-002')!.plannedChange!.state).toBe('current');
  });

  it('detects an outdated brief when the source changes (AC-12)', async () => {
    const workspace = await planWithSource();
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        source_documents: [{ path: 'docs/v.md', sha256: sha256('# vision\n') }],
        changes: [change({ id: 'CH-001', slug: 'x' })],
      })
    );
    await generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-001'] });

    await writeFile(path.join(workspace.projectRoot, 'docs/v.md'), '# vision changed\n');
    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.changes[0].plannedChange!.state).toBe('outdated');
    expect(status.diagnostics.some((d) => d.code === 'source_changed')).toBe(true);
  });

  it('refuses an increment with an unknown dependency, writing nothing (AC-17)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'x', depends_on: ['CH-099'] })] })
    );
    await expect(
      generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-001'] })
    ).rejects.toMatchObject({ code: 'unknown_dependency' });
  });

  it('honours --expect-revision', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({ id: 'demo', revision: 5, changes: [change({ id: 'CH-001', slug: 'x' })] })
    );
    await expect(
      generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-001'], expectRevision: 4 })
    ).rejects.toMatchObject({ code: 'plan_revision_conflict' });
  });

  it('projects the roadmap into plan.md, preserving text outside the markers (AC-20)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        milestones: [{ id: 'M1', name: 'Um', order: 1, changes: ['CH-001'] }],
        changes: [change({ id: 'CH-001', slug: 'x', milestone: 'M1' })],
      })
    );
    const planDoc = path.join(workspace.projectRoot, 'planning/demo/plan.md');
    await fs.writeFile(planDoc, '# Demo\n\n## Visão\n\nTEXTO HUMANO\n');

    await generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-001'] });
    const out = await fs.readFile(planDoc, 'utf8');
    expect(out).toContain('TEXTO HUMANO');
    expect(out).toContain('<!-- specs:roadmap:begin -->');
    expect(out).toContain('| CH-001 |');
  });

  it('fails with roadmap_markers_invalid on an unbalanced plan.md (AC-21)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'x' })] }));
    await fs.writeFile(
      path.join(workspace.projectRoot, 'planning/demo/plan.md'),
      '# Demo\n\n<!-- specs:roadmap:begin -->\nsem fim\n'
    );
    await expect(
      generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-001'] })
    ).rejects.toMatchObject({ code: 'roadmap_markers_invalid' });
  });
});
