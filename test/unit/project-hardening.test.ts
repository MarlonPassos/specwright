import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPlanBundle } from '../../src/core/project/apply.js';
import { computeProjectStatus, showProjectChange } from '../../src/core/project/status.js';
import { linkChange, adoptChange } from '../../src/core/project/link.js';
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

describe('an already-invalid brief is never `ready` (R-01, FR-22)', () => {
  it('blocks readiness, diagnoses it, and keeps `next` from recommending it', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', status: 'active', changes: [] }));
    await applyPlanBundle(workspace, 'p', {
      bundleVersion: BUNDLE_VERSION,
      expectRevision: 0,
      operations: [
        { op: 'addChange', ref: '$a', slug: 'alpha', title: 'Alpha',
          plannedChange: { objetivo: 'o', escopo: ['s'], criteriosMacro: ['c'] } },
      ],
    });

    // Strip the required sections and realign the content hash, so the brief is
    // structurally invalid while every hash still matches.
    const briefPath = path.join(workspace.projectRoot, 'planning/p/planned-changes/CH-001-alpha.md');
    const broken =
      '---\nschema_version: 1\nid: CH-001\nslug: alpha\ntitle: Alpha\nplan_revision: 1\n---\n\n# Objetivo\n\nSó objetivo.\n';
    await fs.writeFile(briefPath, broken);
    const { sha256 } = await import('../../src/core/project/hashes.js');
    const yamlPath = path.join(workspace.projectRoot, 'planning/p/plan.yaml');
    await fs.writeFile(
      yamlPath,
      (await fs.readFile(yamlPath, 'utf8')).replace(/content_hash: \w+/, `content_hash: ${sha256(broken)}`)
    );

    const status = await computeProjectStatus(workspace, 'p');
    const view = status.changes[0];
    expect(view.plannedChange!.state).toBe('current');   // os hashes conferem…
    expect(view.readiness).toBe('blocked');              // …mas o conteúdo não é válido
    expect(view.readinessReasons).toContain('diagnostic_blocking');
    expect(view.presentation).toBe('inconsistente');
    expect(status.diagnostics.some((d) => d.code === 'planned_change_invalid')).toBe(true);

    const { recommendNext } = await import('../../src/core/project/next.js');
    expect(recommendNext(status).recommended).toBeNull();
  });

  it('refuses a mutation that touches it, and leaves every byte in place', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', status: 'active', changes: [] }));
    await applyPlanBundle(workspace, 'p', {
      bundleVersion: BUNDLE_VERSION,
      expectRevision: 0,
      operations: [
        { op: 'addChange', ref: '$a', slug: 'alpha', title: 'Alpha',
          plannedChange: { objetivo: 'o', escopo: ['s'], criteriosMacro: ['c'] } },
      ],
    });
    const briefPath = path.join(workspace.projectRoot, 'planning/p/planned-changes/CH-001-alpha.md');
    const broken =
      '---\nschema_version: 1\nid: CH-001\nslug: alpha\ntitle: Alpha\nplan_revision: 1\n---\n\n# Objetivo\n\nSó objetivo.\n';
    await fs.writeFile(briefPath, broken);
    const { sha256 } = await import('../../src/core/project/hashes.js');
    const yamlPath = path.join(workspace.projectRoot, 'planning/p/plan.yaml');
    await fs.writeFile(
      yamlPath,
      (await fs.readFile(yamlPath, 'utf8')).replace(/content_hash: \w+/, `content_hash: ${sha256(broken)}`)
    );

    const before = await fingerprint(workspace.projectRoot);
    await expect(
      applyPlanBundle(workspace, 'p', {
        bundleVersion: BUNDLE_VERSION,
        expectRevision: 1,
        operations: [{ op: 'updateChange', id: 'CH-001', set: { priority: 'low' } }],
      })
    ).rejects.toMatchObject({ code: 'plan_invalid' });
    expect(await fingerprint(workspace.projectRoot)).toEqual(before);
  });

  it('does NOT deadlock on the deliberate skeleton generate writes elsewhere (§7.5)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', status: 'active', changes: [] }));
    await applyPlanBundle(workspace, 'p', {
      bundleVersion: BUNDLE_VERSION,
      expectRevision: 0,
      operations: [
        { op: 'addChange', ref: '$a', slug: 'alpha', title: 'Alpha',
          plannedChange: { objetivo: 'o', escopo: ['s'], criteriosMacro: ['c'] } },
        { op: 'addChange', ref: '$b', slug: 'beta', title: 'Beta' },
      ],
    });
    const { generatePlannedChanges } = await import('../../src/core/project/generate.js');
    await generatePlannedChanges(workspace, 'p', { changeIds: ['CH-002'] });

    const result = await applyPlanBundle(workspace, 'p', {
      bundleVersion: BUNDLE_VERSION,
      expectRevision: 2,
      operations: [{ op: 'updateChange', id: 'CH-001', set: { priority: 'low' } }],
    });
    expect(result.applied).toBe(true);
    // The pre-existing skeleton is reported, not silently ignored — one entry.
    const reported = result.diagnostics.filter((d) => d.code === 'planned_change_invalid');
    expect(reported).toHaveLength(1);
    expect(reported[0].message).toContain('CH-002');
  });
});

describe('symlinks never cross the workspace boundary (R-05, I-8)', () => {
  it('refuses adopt and link on a symlinked change directory', async () => {
    const workspace = await makePlanWorkspace();
    const outside = path.join(workspace.projectRoot, '..', `outside-${Date.now()}`);
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'proposal.md'), '## Why\n\nSYMLINK-SECRET.\n');
    await fs.mkdir(workspace.changesPath, { recursive: true });
    await fs.symlink(outside, path.join(workspace.changesPath, 'evil'));

    await seedPlan(workspace, manifest({ id: 'p', changes: [change({ id: 'CH-001', slug: 'a' })] }));

    await expect(adoptChange(workspace, 'p', 'evil')).rejects.toMatchObject({
      code: 'link_target_missing',
    });
    await expect(linkChange(workspace, 'p', 'CH-001', 'evil')).rejects.toMatchObject({
      code: 'link_target_missing',
    });
    await fs.rm(outside, { recursive: true, force: true });
  });
});

describe('a failed multi-file commit rolls back (R-07, NFR-07, AC-49)', () => {
  it('refuses when a destination is a directory, leaving revision and bytes intact', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'p', status: 'active', changes: [] }));

    // architecture.md becomes a directory: the rename can never succeed.
    const arch = path.join(workspace.projectRoot, 'planning/p/architecture.md');
    await fs.rm(arch, { force: true });
    await fs.mkdir(arch, { recursive: true });
    await fs.writeFile(path.join(arch, 'sentinela'), 'x');

    const before = await fingerprint(workspace.projectRoot);
    await expect(
      applyPlanBundle(workspace, 'p', {
        bundleVersion: BUNDLE_VERSION,
        expectRevision: 0,
        operations: [{ op: 'writeDocument', target: 'architecture', content: '# Nova\n' }],
      })
    ).rejects.toThrow(/diretório/);

    expect(await fingerprint(workspace.projectRoot)).toEqual(before);
    expect(await fs.readFile(path.join(arch, 'sentinela'), 'utf8')).toBe('x');
    const { loadPlan } = await import('../../src/core/project/repository.js');
    expect((await loadPlan(workspace.projectRoot, 'p')).manifest.revision).toBe(0);
  });
});
