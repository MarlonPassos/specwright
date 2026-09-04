import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlan } from '../../src/core/project/create.js';
import { applyPlanBundle } from '../../src/core/project/apply.js';
import { validatePlan } from '../../src/core/project/validate.js';
import { generatePlannedChanges } from '../../src/core/project/generate.js';
import { computeProjectStatus } from '../../src/core/project/status.js';
import { recommendNext } from '../../src/core/project/next.js';
import { linkChange } from '../../src/core/project/link.js';
import { syncPlan } from '../../src/core/project/sync.js';
import { BUNDLE_VERSION } from '../../src/core/project/bundle.js';
import { archiveChange } from '../../src/core/archive/archive.js';
import { withStaging } from '../../src/util/fs.js';
import { makeWorkspace, seedChange, writeFile } from '../helpers/workspace.js';

/**
 * §12.3: the whole loop, end to end —
 * create → apply → validate → generate → status → next → link → archive → sync → status.
 * It asserts structure and invariants, never prose a model produced.
 */
describe('project lifecycle', () => {
  it('fecha o vínculo automático no archive que acabou de ser criado', async () => {
    const workspace = await makeWorkspace();
    const root = workspace.projectRoot;
    await createPlan(root, 'shop', {});
    await applyPlanBundle(workspace, 'shop', {
      bundleVersion: BUNDLE_VERSION,
      expectRevision: 0,
      operations: [{ op: 'addChange', ref: '$same', slug: 'same-slug', title: 'Same' }],
    });

    const date = '2026-01-01';
    for (const suffix of ['2', '10']) {
      await fs.mkdir(path.join(workspace.archivePath, `${date}-same-slug-${suffix}`), {
        recursive: true,
      });
    }
    await seedChange(workspace, 'same-slug', { tasks: '## 1\n- [x] 1.1 feito\n' });

    const archived = await archiveChange(workspace, 'same-slug', {
      now: new Date(2026, 0, 1),
      validate: false,
    });

    expect(archived.plan?.archivePath).toBe(
      'spec/changes/archive/2026-01-01-same-slug'
    );
    expect(archived.plan?.archivePath).not.toContain('same-slug-10');
  });

  it('rollbacka os specs se o rename final do archive falhar', async () => {
    const workspace = await makeWorkspace();
    await writeFile(path.join(workspace.specsPath, 'a/spec.md'), 'old');

    await expect(
      // The hook is the deterministic equivalent of a rename failure after the
      // spec commit. The utility must restore the old bytes before propagating it.
      withStaging(
        workspace.specsPath,
        async (stage) => stage('a/spec.md', 'new'),
        async () => {
          throw new Error('rename failed');
        }
      )
    ).rejects.toThrow('rename failed');
    expect(await fs.readFile(path.join(workspace.specsPath, 'a/spec.md'), 'utf8')).toBe('old');
  });

  it('walks a plan from a source document to an archived, recalculated increment', async () => {
    const workspace = await makeWorkspace();
    const root = workspace.projectRoot;
    await writeFile(path.join(root, 'docs/vision.md'), '# Visão\n\nAuth e catálogo.\n');

    // 1. create
    const created = await createPlan(root, 'shop', {
      name: 'Loja',
      sources: ['docs/vision.md'],
    });
    expect(created.revision).toBe(0);

    // 2. apply — two increments in a chain, inside one milestone
    const applied = await applyPlanBundle(workspace, 'shop', {
      bundleVersion: BUNDLE_VERSION,
      expectRevision: 0,
      plan: { status: 'active' },
      operations: [
        {
          op: 'addChange',
          ref: '$a',
          slug: 'auth',
          title: 'Autenticação',
          priority: 'critical',
          plannedChange: {
            objetivo: 'Permitir que alguém se identifique.',
            escopo: ['início de sessão'],
            criteriosMacro: ['uma sessão pode ser encerrada'],
          },
        },
        {
          op: 'addChange',
          ref: '$b',
          slug: 'catalog',
          title: 'Catálogo',
          dependsOn: ['$a'],
          plannedChange: {
            objetivo: 'Listar produtos.',
            escopo: ['grade'],
            criteriosMacro: ['filtra por categoria'],
          },
        },
        {
          op: 'setMilestones',
          milestones: [{ id: 'M1', name: 'Fundação', order: 1, changes: ['$a', '$b'] }],
        },
      ],
    });
    expect(applied.applied).toBe(true);
    expect(applied.idMap).toEqual({ $a: 'CH-001', $b: 'CH-002' });

    // 3. validate — a plan built from a complete bundle is clean
    const reports = await validatePlan(root, 'shop', {});
    expect(reports.every((report) => report.valid)).toBe(true);

    // 4. generate is idempotent over what apply already materialised
    const regenerated = await generatePlannedChanges(workspace, 'shop', {});
    expect(regenerated.written).toEqual([]);
    expect(regenerated.skipped.map((entry) => entry.id).sort()).toEqual(['CH-001', 'CH-002']);

    // 5. status + next — CH-001 ready, CH-002 blocked by it
    let status = await computeProjectStatus(workspace, 'shop');
    expect(status.changes.find((c) => c.id === 'CH-001')!.readiness).toBe('ready');
    expect(status.changes.find((c) => c.id === 'CH-002')!.blockedBy).toEqual(['CH-001']);
    expect(recommendNext(status).recommended!.id).toBe('CH-001');

    // 6. the change cycle takes over: a real change is created and linked
    await seedChange(workspace, 'auth', { tasks: '## 1\n- [x] 1.1 feito\n' });
    const linked = await linkChange(workspace, 'shop', 'CH-001', 'auth');
    expect(linked.execution).toBe('verifying');

    status = await computeProjectStatus(workspace, 'shop');
    expect(status.changes.find((c) => c.id === 'CH-001')!.presentation).toBe('em implementação');

    // 7. Simulate the existing cycle moving it into the archive. This test
    // exercises the read-only evidence path; the native `archive` command's
    // best-effort plan closure is covered by the CLI integration tests.
    await fs.mkdir(path.join(workspace.archivePath, '2026-09-01-auth'), { recursive: true });
    await fs.rm(path.join(workspace.changesPath, 'auth'), { recursive: true, force: true });

    // 8. status alone already reads the archive: execution is evidence, not a field
    status = await computeProjectStatus(workspace, 'shop');
    expect(status.changes.find((c) => c.id === 'CH-001')!.execution).toBe('archived');
    expect(status.changes.find((c) => c.id === 'CH-001')!.presentation).toBe('concluída');
    // and the dependent is recalculated as ready
    expect(status.changes.find((c) => c.id === 'CH-002')!.readiness).toBe('ready');
    expect(recommendNext(status).recommended!.id).toBe('CH-002');

    // 9. sync persists the archive shortcut and is then idempotent
    const synced = await syncPlan(workspace, 'shop', {});
    expect(synced.resolved).toEqual([
      { id: 'CH-001', archivePath: 'spec/changes/archive/2026-09-01-auth' },
    ]);
    expect((await syncPlan(workspace, 'shop', {})).synced).toBe(false);

    // 10. the plan is still valid and the progress reflects the archive
    expect((await validatePlan(root, 'shop', {})).every((r) => r.valid)).toBe(true);
    status = await computeProjectStatus(workspace, 'shop');
    expect(status.progress).toMatchObject({ total: 2, archived: 1, percent: 50 });
    expect(status.milestones[0]).toMatchObject({ id: 'M1', archived: 1, total: 2 });
  });
});
