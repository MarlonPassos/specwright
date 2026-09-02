import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPlanBundle } from '../../src/core/project/apply.js';
import { computeProjectStatus, showProjectChange } from '../../src/core/project/status.js';
import { linkChange } from '../../src/core/project/link.js';
import { savePlan, loadPlan } from '../../src/core/project/repository.js';
import { planPaths } from '../../src/core/project/paths.js';
import { BUNDLE_VERSION } from '../../src/core/project/bundle.js';
import { makePlanWorkspace, seedPlan, manifest, change } from '../helpers/plan.js';

async function fingerprint(root: string): Promise<Record<string, string>> {
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

describe('pre-write validation of the proposed tree (R-01)', () => {
  it('refuses a bundle whose brief would be invalid, writing nothing', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', status: 'active', changes: [] }));
    const before = await fingerprint(workspace.projectRoot);

    await expect(
      applyPlanBundle(workspace, 'p', {
        bundleVersion: BUNDLE_VERSION,
        expectRevision: 0,
        // Empty spec → Escopo and Critérios macro come out empty → ERROR.
        operations: [{ op: 'addChange', ref: '$a', slug: 'alpha', title: 'Alpha', plannedChange: {} }],
      })
    ).rejects.toMatchObject({ code: 'plan_invalid' });

    expect(await fingerprint(workspace.projectRoot)).toEqual(before);
  });

  it('refuses an unsafe sourceDocuments path, writing nothing (R-02a)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', status: 'active', changes: [] }));
    const before = await fingerprint(workspace.projectRoot);

    await expect(
      applyPlanBundle(workspace, 'p', {
        bundleVersion: BUNDLE_VERSION,
        expectRevision: 0,
        plan: { sourceDocuments: ['../../../outside.md'] },
        operations: [],
      })
    ).rejects.toMatchObject({ code: 'unsafe_source_path' });

    expect(await fingerprint(workspace.projectRoot)).toEqual(before);
  });
});

describe('persisted paths are read fail-closed (R-02b, I-8, NFR-08)', () => {
  it('never reads a brief from outside the plan directory', async () => {
    const workspace = await makePlanWorkspace();
    const outside = path.join(workspace.projectRoot, '..', 'outside-brief.md');
    await fs.writeFile(
      outside,
      '---\nschema_version: 1\nid: CH-001\nslug: x\ntitle: X\nplan_revision: 0\n---\n\n# Objetivo\n\nSEGREDO-EXTERNO\n'
    );
    await seedPlan(
      workspace,
      manifest({
        id: 'p',
        changes: [
          change({
            id: 'CH-001',
            slug: 'x',
            planned_change: {
              path: '../../../outside-brief.md',
              generated_from_plan_revision: 0,
              source_hash: 's',
              content_hash: 'c',
            },
          }),
        ],
      })
    );

    const status = await computeProjectStatus(workspace, 'p');
    // The read fails closed: the brief reads as missing, not as current.
    expect(status.changes[0].plannedChange!.state).toBe('missing');

    const shown = await showProjectChange(workspace, 'p', 'CH-001');
    expect(JSON.stringify(shown)).not.toContain('SEGREDO-EXTERNO');
    await fs.rm(outside, { force: true });
  });
});

describe('link requires a directory (R-04, FR-29)', () => {
  it('refuses a regular file with the change name', async () => {
    const workspace = await makePlanWorkspace();
    await fs.mkdir(workspace.changesPath, { recursive: true });
    await fs.writeFile(path.join(workspace.changesPath, 'filetarget'), 'não sou um diretório');
    await seedPlan(workspace, manifest({ id: 'p', changes: [change({ id: 'CH-001', slug: 'a' })] }));

    await expect(linkChange(workspace, 'p', 'CH-001', 'filetarget')).rejects.toMatchObject({
      code: 'link_target_missing',
    });
  });
});

describe('concurrent writers cannot lose an update (R-03)', () => {
  it('two savePlan calls on the same revision: one wins, one conflicts', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', revision: 0, changes: [] }));
    const paths = planPaths(workspace.projectRoot, 'p');
    const { manifest: base } = await loadPlan(workspace.projectRoot, 'p');

    const results = await Promise.allSettled([
      savePlan(paths, { ...base, name: 'Escritor A' }),
      savePlan(paths, { ...base, name: 'Escritor B' }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'plan_revision_conflict',
    });

    const { manifest: after } = await loadPlan(workspace.projectRoot, 'p');
    expect(after.revision).toBe(1);
  });

  it('leaves no lock file behind', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', changes: [] }));
    const paths = planPaths(workspace.projectRoot, 'p');
    const { manifest: base } = await loadPlan(workspace.projectRoot, 'p');
    await savePlan(paths, base);
    expect(await fs.readdir(paths.dir)).not.toContain('.plan.lock');
  });
});
