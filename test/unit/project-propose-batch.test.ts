import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeProposeBatch } from '../../src/core/project/proposeBatch.js';
import { computeProjectStatus } from '../../src/core/project/status.js';
import { activePath } from '../../src/core/project/link.js';
import { makePlanWorkspace, seedPlan, manifest, change, withBrief, seedArchivedChange } from '../helpers/plan.js';
import { seedChange, writeFile } from '../helpers/workspace.js';
import type { WorkspaceConfig } from '../../src/core/config.js';
import type { Workspace } from '../../src/core/workspace.js';
import type { ChangeLink, ProjectChange } from '../../src/core/project/model.js';

/** Opted in, on a harness that dispatches subagents - the baseline for `enabled`. */
const ON: WorkspaceConfig = { schema: 'spec-driven', parallelPropose: true, harnesses: ['claude'] };

function linkTo(name: string): ChangeLink {
  return { name, active_path: activePath(name), archive_path: null, linked_at: '2024-01-01' };
}

/**
 * Planned, brief written and current, never linked: the shape a candidate has.
 *
 * `depends_on` goes in BEFORE `withBrief`, not after: the brief's `record_hash`
 * covers the dependency list, so setting it afterwards would leave every such
 * change reading as `planned_change_outdated` instead of reaching the real check.
 */
async function proposable(
  workspace: Workspace,
  planId: string,
  input: { id: string; slug: string; priority?: ProjectChange['priority']; dependsOn?: string[] }
): Promise<ProjectChange> {
  return withBrief(
    workspace,
    planId,
    change({
      id: input.id,
      slug: input.slug,
      priority: input.priority,
      depends_on: input.dependsOn ?? [],
    })
  );
}

/** Same, but already carried through propose: linked to a change dir with every artifact. */
async function alreadyProposed(
  workspace: Workspace,
  planId: string,
  input: { id: string; slug: string }
): Promise<ProjectChange> {
  await seedChange(workspace, input.slug);
  const base = await withBrief(workspace, planId, change({ id: input.id, slug: input.slug }));
  return { ...base, link: linkTo(input.slug) };
}

const ENV_KEY = 'SPECS_HARNESS';

describe('computeProposeBatch', () => {
  // The harness that RUNS the tests sets its own env marker, and a marker beats
  // config - so every case pins the harness explicitly instead of inheriting it.
  beforeEach(() => {
    process.env[ENV_KEY] = 'claude';
  });
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('batches every planned change the graph frees at once', async () => {
    const workspace = await makePlanWorkspace();
    const a = await proposable(workspace, 'demo', { id: 'CH-001', slug: 'alpha' });
    const b = await proposable(workspace, 'demo', { id: 'CH-002', slug: 'beta' });
    await seedPlan(workspace, manifest({ id: 'demo', changes: [a, b] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeProposeBatch(workspace, status, ON);

    expect(result.enabled).toBe(true);
    expect(result.batch.map((entry) => entry.id).sort()).toEqual(['CH-001', 'CH-002']);
    expect(result.excluded).toEqual([]);
  });

  it('holds back a change whose dependency has not been proposed yet', async () => {
    const workspace = await makePlanWorkspace();
    const a = await proposable(workspace, 'demo', { id: 'CH-001', slug: 'alpha' });
    const b = await proposable(workspace, 'demo', { id: 'CH-002', slug: 'beta', dependsOn: ['CH-001'] });
    await seedPlan(workspace, manifest({ id: 'demo', changes: [a, b] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeProposeBatch(workspace, status, ON);

    // The wave is CH-001 alone; CH-002 waits for it - and a batch can never
    // hold a change together with its own dependency.
    expect(result.batch.map((entry) => entry.id)).toEqual(['CH-001']);
    expect(result.excluded).toContainEqual({
      id: 'CH-002',
      reason: 'depends_on_not_proposed:CH-001',
    });
  });

  it('frees the next wave once the dependency is proposed, without waiting for it to be archived', async () => {
    const workspace = await makePlanWorkspace();
    // CH-001 went through propose: linked, every artifact written, NOT archived.
    const done = await alreadyProposed(workspace, 'demo', { id: 'CH-001', slug: 'alpha' });
    const b = await proposable(workspace, 'demo', { id: 'CH-002', slug: 'beta', dependsOn: ['CH-001'] });
    const c = await proposable(workspace, 'demo', { id: 'CH-003', slug: 'gamma', dependsOn: ['CH-001'] });
    await seedPlan(workspace, manifest({ id: 'demo', changes: [done, b, c] }));

    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.changes[0].execution).toBe('proposed'); // proposed, not archived
    const result = await computeProposeBatch(workspace, status, ON);

    expect(result.batch.map((entry) => entry.id).sort()).toEqual(['CH-002', 'CH-003']);
    // The already-proposed one is out because it is done, not because it is blocked.
    expect(result.excluded).toContainEqual({ id: 'CH-001', reason: 'execution_proposed' });
  });

  it('keeps a change waiting when only part of its dependency set is proposed', async () => {
    const workspace = await makePlanWorkspace();
    const done = await alreadyProposed(workspace, 'demo', { id: 'CH-001', slug: 'alpha' });
    const pending = await proposable(workspace, 'demo', { id: 'CH-002', slug: 'beta' });
    const both = await proposable(workspace, 'demo', {
      id: 'CH-003',
      slug: 'gamma',
      dependsOn: ['CH-001', 'CH-002'],
    });
    await seedPlan(workspace, manifest({ id: 'demo', changes: [done, pending, both] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeProposeBatch(workspace, status, ON);

    expect(result.batch.map((entry) => entry.id)).toEqual(['CH-002']);
    expect(result.excluded).toContainEqual({
      id: 'CH-003',
      reason: 'depends_on_not_proposed:CH-002',
    });
  });

  it('excludes a bare §7.5 skeleton: there is nothing to explore FROM', async () => {
    const workspace = await makePlanWorkspace();
    const skeleton = change({ id: 'CH-001', slug: 'alpha' });
    await seedPlan(workspace, manifest({ id: 'demo', changes: [skeleton] }));
    // Materialize the brief as the deliberately-invalid skeleton `generate` writes.
    const { generatePlannedChanges } = await import('../../src/core/project/generate.js');
    await generatePlannedChanges(workspace, 'demo', { changeIds: ['CH-001'] });

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeProposeBatch(workspace, status, ON);

    expect(result.batch).toEqual([]);
    expect(result.excluded).toEqual([{ id: 'CH-001', reason: 'planned_change_invalid' }]);
  });

  it('excludes a change with no brief materialized at all', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'alpha' })] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeProposeBatch(workspace, status, ON);

    expect(result.batch).toEqual([]);
    expect(result.excluded).toEqual([{ id: 'CH-001', reason: 'planned_change_missing' }]);
  });

  it('excludes a change already linked, and one that is on hold', async () => {
    const workspace = await makePlanWorkspace();
    const linked = await alreadyProposed(workspace, 'demo', { id: 'CH-001', slug: 'alpha' });
    const onHold = await proposable(workspace, 'demo', { id: 'CH-002', slug: 'beta' });
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [linked, { ...onHold, planning_state: 'on_hold' }],
      })
    );

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeProposeBatch(workspace, status, ON);

    expect(result.batch).toEqual([]);
    expect(result.excluded).toContainEqual({ id: 'CH-001', reason: 'execution_proposed' });
    expect(result.excluded).toContainEqual({ id: 'CH-002', reason: 'state_on_hold' });
  });

  it('excludes a slug some active change directory already answers to', async () => {
    const workspace = await makePlanWorkspace();
    const a = await proposable(workspace, 'demo', { id: 'CH-001', slug: 'alpha' });
    await seedPlan(workspace, manifest({ id: 'demo', changes: [a] }));
    // A change created by hand, never linked to the increment: `execution`
    // still reads `unlinked`, but `specs new change alpha` would now fail.
    await seedChange(workspace, 'alpha');

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeProposeBatch(workspace, status, ON);

    expect(result.batch).toEqual([]);
    expect(result.excluded).toEqual([{ id: 'CH-001', reason: 'change_already_exists' }]);
  });

  it('excludes a slug only an ARCHIVE answers to — the empty-change trap', async () => {
    const workspace = await makePlanWorkspace();
    const a = await proposable(workspace, 'demo', { id: 'CH-001', slug: 'alpha' });
    await seedPlan(workspace, manifest({ id: 'demo', changes: [a] }));
    // Nothing active carries the name, so `specs new change alpha` would
    // SUCCEED - into a directory the archive then masks (§7.7 resolves the
    // archive first), which is exactly the state nobody can see.
    await seedArchivedChange(workspace, 'alpha');

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeProposeBatch(workspace, status, ON);

    expect(result.batch).toEqual([]);
    expect(result.excluded).toEqual([{ id: 'CH-001', reason: 'change_already_exists' }]);
  });

  it('names the increment whose LINK already owns the slug another one wants', async () => {
    const workspace = await makePlanWorkspace();
    // Two increments can never share a slug (`ProjectGraph.from` refuses it),
    // but a link NAME is free to differ from the increment's own slug: CH-001
    // is `alpha` linked to a change directory called `beta`. CH-002, planned
    // as `beta`, now wants a name CH-001 already answers to - and linking is
    // not the way out of that one, a different slug is.
    await seedChange(workspace, 'beta');
    const ownerBase = await withBrief(workspace, 'demo', change({ id: 'CH-001', slug: 'alpha' }));
    const owner = { ...ownerBase, link: linkTo('beta') };
    const wants = await proposable(workspace, 'demo', { id: 'CH-002', slug: 'beta' });
    await seedPlan(workspace, manifest({ id: 'demo', changes: [owner, wants] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeProposeBatch(workspace, status, ON);

    expect(result.batch).toEqual([]);
    // The more specific reason wins over the bare `change_already_exists` the
    // same directory would otherwise produce.
    expect(result.excluded).toContainEqual({ id: 'CH-002', reason: 'slug_claimed_by:CH-001' });
  });

  it('excludes a change held by a manual blocker', async () => {
    const workspace = await makePlanWorkspace();
    const blocked = await proposable(workspace, 'demo', { id: 'CH-001', slug: 'alpha' });
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [{ ...blocked, manual_blockers: ['esperando jurídico'] }] })
    );

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeProposeBatch(workspace, status, ON);

    expect(result.batch).toEqual([]);
    expect(result.excluded).toEqual([{ id: 'CH-001', reason: 'manual_blocker_present' }]);
  });

  it('orders the batch by priority, so a partial pick takes the important ones first', async () => {
    const workspace = await makePlanWorkspace();
    const low = await proposable(workspace, 'demo', { id: 'CH-001', slug: 'alpha', priority: 'low' });
    const critical = await proposable(workspace, 'demo', {
      id: 'CH-002',
      slug: 'beta',
      priority: 'critical',
    });
    await seedPlan(workspace, manifest({ id: 'demo', changes: [low, critical] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeProposeBatch(workspace, status, ON);

    expect(result.batch.map((entry) => entry.id)).toEqual(['CH-002', 'CH-001']);
  });

  it('carries the slug, title and brief path each subagent needs as input', async () => {
    const workspace = await makePlanWorkspace();
    const a = await proposable(workspace, 'demo', { id: 'CH-001', slug: 'alpha' });
    await seedPlan(workspace, manifest({ id: 'demo', changes: [a] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeProposeBatch(workspace, status, ON);

    expect(result.batch[0]).toEqual({
      id: 'CH-001',
      slug: 'alpha',
      title: a.title,
      plannedChange: 'planned-changes/CH-001-alpha.md',
    });
  });

  describe('enabled', () => {
    it('is false when the workspace never opted in', async () => {
      const workspace = await makePlanWorkspace();
      const a = await proposable(workspace, 'demo', { id: 'CH-001', slug: 'alpha' });
      const b = await proposable(workspace, 'demo', { id: 'CH-002', slug: 'beta' });
      await seedPlan(workspace, manifest({ id: 'demo', changes: [a, b] }));

      const status = await computeProjectStatus(workspace, 'demo');
      const result = await computeProposeBatch(workspace, status, {
        schema: 'spec-driven',
        harnesses: ['claude'],
      });

      expect(result.enabled).toBe(false);
      // The batch is still computed - a disabled workspace can see what it would get.
      expect(result.batch.map((entry) => entry.id).sort()).toEqual(['CH-001', 'CH-002']);
    });

    it('is false on a harness that cannot dispatch subagents', async () => {
      const workspace = await makePlanWorkspace();
      const a = await proposable(workspace, 'demo', { id: 'CH-001', slug: 'alpha' });
      await seedPlan(workspace, manifest({ id: 'demo', changes: [a] }));

      process.env[ENV_KEY] = 'codex';
      const status = await computeProjectStatus(workspace, 'demo');
      const result = await computeProposeBatch(workspace, status, {
        schema: 'spec-driven',
        parallelPropose: true,
        harnesses: ['codex'],
      });

      expect(result.enabled).toBe(false);
    });
  });
});

describe('renderConfig — parallelPropose', () => {
  it('ships in a fresh config.yaml already set to false, with guidance', async () => {
    const { renderConfig } = await import('../../src/core/config.js');
    const out = renderConfig({ schema: 'spec-driven' });
    expect(out).toContain('parallelPropose: false');
    expect(out).toMatch(/# .*propor em paralelo/);
  });

  it('round-trips a workspace that turned it on', async () => {
    const { renderConfig, loadConfig } = await import('../../src/core/config.js');
    const { workspaceAt } = await import('../../src/core/workspace.js');
    const { makeTempDir } = await import('../helpers/workspace.js');

    const dir = await makeTempDir();
    const workspace = workspaceAt(dir);
    await writeFile(workspace.configPath, renderConfig({ schema: 'spec-driven', parallelPropose: true }));

    expect((await loadConfig(workspace)).parallelPropose).toBe(true);
  });
});
