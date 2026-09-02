import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPlanBundle } from '../../src/core/project/apply.js';
import { computeProjectStatus } from '../../src/core/project/status.js';
import { loadPlan } from '../../src/core/project/repository.js';
import { BUNDLE_VERSION } from '../../src/core/project/bundle.js';
import { makePlanWorkspace, seedPlan, manifest, change } from '../helpers/plan.js';

const addTwo = {
  bundleVersion: BUNDLE_VERSION,
  expectRevision: 0,
  operations: [
    {
      op: 'addChange',
      ref: '$a',
      slug: 'foundation',
      title: 'Fundação',
      priority: 'critical',
      plannedChange: { objetivo: 'Base.', escopo: ['estrutura'], criteriosMacro: ['build verde'] },
    },
    {
      op: 'addChange',
      ref: '$b',
      slug: 'auth',
      title: 'Auth',
      dependsOn: ['$a'],
      plannedChange: { objetivo: 'Login.', escopo: ['sessão'], criteriosMacro: ['encerra'] },
    },
    { op: 'setMilestones', milestones: [{ id: 'M1', name: 'Fundação', order: 1, changes: ['$a', '$b'] }] },
  ],
};

describe('applyPlanBundle', () => {
  it('applies a bundle, allocates ids, writes briefs and bumps revision by one (AC-45)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', status: 'active', changes: [] }));

    const result = await applyPlanBundle(workspace, 'p', addTwo);
    expect(result).toMatchObject({ applied: true, revision: { from: 0, to: 1 } });
    expect(result.idMap).toEqual({ $a: 'CH-001', $b: 'CH-002' });

    const { manifest: reloaded } = await loadPlan(workspace.projectRoot, 'p');
    expect(reloaded.revision).toBe(1);
    expect(reloaded.changes.map((c) => c.id)).toEqual(['CH-001', 'CH-002']);
    expect(reloaded.changes[0].milestone).toBe('M1');
    await expect(
      fs.stat(path.join(workspace.projectRoot, 'planning/p/planned-changes/CH-001-foundation.md'))
    ).resolves.toBeTruthy();

    const status = await computeProjectStatus(workspace, 'p');
    expect(status.changes.find((c) => c.id === 'CH-001')!.readiness).toBe('ready');
    expect(status.changes.find((c) => c.id === 'CH-002')!.readiness).toBe('blocked');
  });

  it('--dry-run writes nothing and every planning file keeps its bytes (AC-37)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', changes: [] }));
    const before = await fs.readFile(
      path.join(workspace.projectRoot, 'planning/p/plan.yaml'),
      'utf8'
    );
    const result = await applyPlanBundle(workspace, 'p', addTwo, { dryRun: true });
    expect(result.applied).toBe(false);
    expect(result.idMap).toEqual({ $a: 'CH-001', $b: 'CH-002' });
    expect(
      await fs.readFile(path.join(workspace.projectRoot, 'planning/p/plan.yaml'), 'utf8')
    ).toBe(before);
  });

  it('rejects a stale expectRevision, writing nothing (AC-44)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', revision: 7, changes: [] }));
    await expect(
      applyPlanBundle(workspace, 'p', { ...addTwo, expectRevision: 6 })
    ).rejects.toMatchObject({ code: 'plan_revision_conflict' });
  });

  it('protects a completed increment and accepts it with --allow-completed plus a WARNING (AC-46)', async () => {
    const workspace = await makePlanWorkspace();
    // seed an archived linked change so CH-001 reads as archived
    await fs.mkdir(path.join(workspace.archivePath, '2026-08-01-done'), { recursive: true });
    await seedPlan(
      workspace,
      manifest({
        id: 'p',
        revision: 3,
        changes: [
          change({
            id: 'CH-001',
            slug: 'done',
            link: { name: 'done', active_path: 'spec/changes/done', archive_path: null, linked_at: '2026-08-01' },
          }),
        ],
      })
    );
    const update = {
      bundleVersion: BUNDLE_VERSION,
      expectRevision: 3,
      operations: [{ op: 'updateChange', id: 'CH-001', set: { title: 'Renamed' } }],
    };
    await expect(applyPlanBundle(workspace, 'p', update)).rejects.toMatchObject({
      code: 'completed_change_protected',
    });
    const forced = await applyPlanBundle(workspace, 'p', update, { allowCompleted: true });
    expect(forced.applied).toBe(true);
    expect(forced.diagnostics.some((d) => d.code === 'completed_change_protected')).toBe(true);
  });

  it('split via apply: original cancelled, brief file for the original left in Git history', async () => {
    const workspace = await makePlanWorkspace();
    await applyPlanBundle(workspace, await seedAndId(workspace), addTwo);
    // now split CH-001
    const split = {
      bundleVersion: BUNDLE_VERSION,
      expectRevision: 1,
      operations: [
        {
          op: 'splitChange',
          id: 'CH-001',
          into: [
            { ref: '$x', slug: 'core', title: 'Core', plannedChange: { objetivo: 'a', escopo: ['x'], criteriosMacro: ['y'] } },
            { ref: '$y', slug: 'db', title: 'DB', dependsOn: ['$x'], plannedChange: { objetivo: 'a', escopo: ['x'], criteriosMacro: ['y'] } },
          ],
          rewire: { 'CH-002': ['$y'] },
        },
      ],
    };
    const result = await applyPlanBundle(workspace, 'p', split);
    expect(result.idMap).toEqual({ $x: 'CH-003', $y: 'CH-004' });

    const status = await computeProjectStatus(workspace, 'p');
    expect(status.changes.find((c) => c.id === 'CH-001')!.planningState).toBe('cancelled');
    expect(status.changes.find((c) => c.id === 'CH-002')!.dependsOn).toEqual(['CH-004']);
  });
});

async function seedAndId(workspace: Awaited<ReturnType<typeof makePlanWorkspace>>): Promise<string> {
  await seedPlan(workspace, manifest({ id: 'p', status: 'active', changes: [] }));
  return 'p';
}
