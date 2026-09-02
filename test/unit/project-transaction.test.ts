import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generatePlannedChanges } from '../../src/core/project/generate.js';
import { applyPlanBundle } from '../../src/core/project/apply.js';
import { computeProjectStatus } from '../../src/core/project/status.js';
import { validatePlan } from '../../src/core/project/validate.js';
import { BUNDLE_VERSION } from '../../src/core/project/bundle.js';
import { makePlanWorkspace, seedPlan, manifest, change } from '../helpers/plan.js';

/** sha of every file under `planning/`, so a failure can be proved byte-neutral. */
async function planningFingerprint(root: string): Promise<Record<string, string>> {
  const { createHash } = await import('node:crypto');
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[full] = createHash('sha256').update(await fs.readFile(full)).digest('hex');
    }
  };
  await walk(path.join(root, 'planning'));
  return out;
}

const addAlpha = {
  bundleVersion: BUNDLE_VERSION,
  expectRevision: 0,
  operations: [
    {
      op: 'addChange',
      ref: '$a',
      slug: 'alpha',
      title: 'Alpha',
      plannedChange: { objetivo: 'Base.', escopo: ['x'], criteriosMacro: ['y'] },
    },
  ],
};

describe('transaction: a failed mutation leaves no partial state', () => {
  it('generate refuses unbalanced roadmap markers BEFORE writing anything (AC-21, NFR-07)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({ id: 'p', status: 'active', changes: [change({ id: 'CH-001', slug: 'alpha' })] })
    );
    await fs.writeFile(
      path.join(workspace.projectRoot, 'planning/p/plan.md'),
      '# P\n\n<!-- specs:roadmap:begin -->\nsem fim\n'
    );

    const before = await planningFingerprint(workspace.projectRoot);
    await expect(
      generatePlannedChanges(workspace, 'p', { changeIds: ['CH-001'] })
    ).rejects.toMatchObject({ code: 'roadmap_markers_invalid' });

    expect(await planningFingerprint(workspace.projectRoot)).toEqual(before);
  });

  it('apply refuses unbalanced roadmap markers BEFORE writing anything', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', status: 'active', changes: [] }));
    await fs.writeFile(
      path.join(workspace.projectRoot, 'planning/p/plan.md'),
      '# P\n\n<!-- specs:roadmap:begin -->\nsem fim\n'
    );

    const before = await planningFingerprint(workspace.projectRoot);
    await expect(applyPlanBundle(workspace, 'p', addAlpha)).rejects.toMatchObject({
      code: 'roadmap_markers_invalid',
    });
    expect(await planningFingerprint(workspace.projectRoot)).toEqual(before);
  });

  it('a rejected bundle leaves every byte under planning/ untouched', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({
        id: 'p',
        status: 'active',
        changes: [change({ id: 'CH-001', slug: 'a' }), change({ id: 'CH-002', slug: 'b' })],
      })
    );
    const before = await planningFingerprint(workspace.projectRoot);
    await expect(
      applyPlanBundle(workspace, 'p', {
        bundleVersion: BUNDLE_VERSION,
        expectRevision: 0,
        operations: [
          { op: 'setDependencies', id: 'CH-001', dependsOn: ['CH-002'] },
          { op: 'setDependencies', id: 'CH-002', dependsOn: ['CH-001'] },
        ],
      })
    ).rejects.toMatchObject({ code: 'dependency_cycle' });
    expect(await planningFingerprint(workspace.projectRoot)).toEqual(before);
  });

  it('renameSlug carries the brief to the new path and leaves the plan valid (FR-43, AC-50)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', status: 'active', changes: [] }));
    await applyPlanBundle(workspace, 'p', addAlpha);

    const briefDir = path.join(workspace.projectRoot, 'planning/p/planned-changes');
    const original = await fs.readFile(path.join(briefDir, 'CH-001-alpha.md'), 'utf8');

    const renamed = await applyPlanBundle(workspace, 'p', {
      bundleVersion: BUNDLE_VERSION,
      expectRevision: 1,
      operations: [{ op: 'renameSlug', id: 'CH-001', slug: 'beta' }],
    });
    expect(renamed.applied).toBe(true);

    expect(await fs.readdir(briefDir)).toEqual(['CH-001-beta.md']);
    const moved = await fs.readFile(path.join(briefDir, 'CH-001-beta.md'), 'utf8');
    // The prose survives; only the frontmatter slug moves with the rename.
    expect(moved).toContain('Base.');
    expect(moved).toContain('slug: beta');
    expect(moved).not.toContain('slug: alpha');
    expect(moved.replace('slug: beta', 'slug: alpha')).toBe(original);

    const reports = await validatePlan(workspace.projectRoot, 'p', {});
    expect(reports.every((report) => report.valid)).toBe(true);

    const status = await computeProjectStatus(workspace, 'p');
    expect(status.changes[0].id).toBe('CH-001'); // the id survives a rename
    expect(status.changes[0].slug).toBe('beta');
  });

  it('apply honours --expect-revision at the CLI level (FR-39)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', revision: 3, status: 'active', changes: [] }));
    await expect(
      applyPlanBundle(workspace, 'p', { ...addAlpha, expectRevision: 3 }, { expectRevision: 2 })
    ).rejects.toMatchObject({ code: 'plan_revision_conflict' });
  });
});
