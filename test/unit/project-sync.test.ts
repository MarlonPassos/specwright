import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { syncPlan } from '../../src/core/project/sync.js';
import { computeProjectStatus } from '../../src/core/project/status.js';
import { loadPlan } from '../../src/core/project/repository.js';
import {
  makePlanWorkspace,
  seedPlan,
  seedArchivedChange,
  manifest,
  change,
} from '../helpers/plan.js';
import { seedChange } from '../helpers/workspace.js';

const link = (name: string, active: string | null = `spec/changes/${name}`) => ({
  name,
  active_path: active,
  archive_path: null as string | null,
  linked_at: '2026-09-01',
});

describe('syncPlan', () => {
  it('resolves archive_path and recomputes dependents to ready', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'foundation');
    await seedChange(workspace, 'auth', { tasks: '## 1\n- [ ] 1.1 todo\n' });
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({ id: 'CH-001', slug: 'foundation', link: link('foundation') }),
          change({
            id: 'CH-002',
            slug: 'auth',
            depends_on: ['CH-001'],
            link: link('auth'),
            planned_change: {
              path: 'planned-changes/CH-002-auth.md',
              generated_from_plan_revision: 0,
              source_hash: 'x',
              content_hash: 'y',
            },
          }),
        ],
      })
    );

    const result = await syncPlan(workspace, 'demo', {});
    expect(result.synced).toBe(true);
    expect(result.resolved).toEqual([
      { id: 'CH-001', archivePath: 'spec/changes/archive/2026-09-01-foundation' },
    ]);

    const { manifest: reloaded } = await loadPlan(workspace.projectRoot, 'demo');
    expect(reloaded.changes[0].link?.archive_path).toBe(
      'spec/changes/archive/2026-09-01-foundation'
    );
  });

  it('--check writes nothing', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'foundation');
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'foundation', link: link('foundation') })] })
    );
    const before = await fs.readFile(
      path.join(workspace.projectRoot, 'planning/demo/plan.yaml'),
      'utf8'
    );
    const result = await syncPlan(workspace, 'demo', { check: true });
    expect(result.checked).toBe(true);
    expect(result.resolved.length).toBe(1);
    expect(
      await fs.readFile(path.join(workspace.projectRoot, 'planning/demo/plan.yaml'), 'utf8')
    ).toBe(before);
  });

  it('is idempotent: a second run with no new fact writes nothing', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'foundation');
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'foundation', link: link('foundation') })] })
    );
    const first = await syncPlan(workspace, 'demo', {});
    const second = await syncPlan(workspace, 'demo', {});
    expect(second.synced).toBe(false);
    expect(second.revision).toBe(first.revision);
  });

  it('clears active_path when the active dir is gone and an archive resolved', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'foundation');
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'foundation', link: link('foundation') })] })
    );
    const result = await syncPlan(workspace, 'demo', {});
    expect(result.cleared).toContain('CH-001');
    const { manifest: reloaded } = await loadPlan(workspace.projectRoot, 'demo');
    expect(reloaded.changes[0].link?.active_path).toBeNull();
  });

  it('picks the highest collision suffix numerically, not lexically (AC-40)', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'auth', '2026-09-12');
    for (const suffix of [2, 10]) {
      await fs.mkdir(path.join(workspace.archivePath, `2026-09-12-auth-${suffix}`), {
        recursive: true,
      });
    }
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'auth', link: link('auth') })] })
    );
    const result = await syncPlan(workspace, 'demo', {});
    expect(result.resolved[0].archivePath).toBe('spec/changes/archive/2026-09-12-auth-10');
    expect(result.diagnostics.some((d) => d.code === 'ambiguous_archive_match')).toBe(true);
  });

  it('reports dangling_link and keeps execution unknown, never archived', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'gone', link: link('gone') })] })
    );
    const result = await syncPlan(workspace, 'demo', {});
    expect(result.diagnostics.some((d) => d.code === 'dangling_link')).toBe(true);
    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.changes[0].execution).toBe('unknown');
  });
});

describe('syncPlan --link — vincular em lote, sem repetir link à mão', () => {
  it('um sync simples continua nunca inventando vínculo', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'bug-fixes');
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'bug-fixes' })] })
    );
    const result = await syncPlan(workspace, 'demo');
    expect(result.linked).toEqual([]);
    expect((await loadPlan(workspace.projectRoot, 'demo')).manifest.changes[0].link).toBeNull();
  });

  it('vincula a arquivada e a ativa cujo nome é igual ao slug', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'bug-fixes', '2026-09-02');
    await seedChange(workspace, 'packaging');
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({ id: 'CH-001', slug: 'bug-fixes' }),
          change({ id: 'CH-002', slug: 'packaging' }),
          change({ id: 'CH-003', slug: 'sem-change' }),
        ],
      })
    );

    const result = await syncPlan(workspace, 'demo', { link: true });
    expect(result.linked).toEqual([
      { id: 'CH-001', change: 'bug-fixes', activePath: null, archivePath: 'spec/changes/archive/2026-09-02-bug-fixes' },
      { id: 'CH-002', change: 'packaging', activePath: 'spec/changes/packaging', archivePath: null },
    ]);

    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.progress.archived).toBe(1);
    expect(status.diagnostics.some((d) => d.code === 'unclaimed_archive')).toBe(false);
    // CH-003 não tinha change alguma: fica intocado.
    expect(status.changes.find((c) => c.id === 'CH-003')!.execution).toBe('unlinked');
  });

  it('--check mostra o que faria sem gravar', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'packaging');
    await seedPlan(
      workspace,
      manifest({ id: 'demo', revision: 4, changes: [change({ id: 'CH-001', slug: 'packaging' })] })
    );
    const result = await syncPlan(workspace, 'demo', { link: true, check: true });
    expect(result.linked).toHaveLength(1);
    expect(result.synced).toBe(false);
    const { manifest: reloaded } = await loadPlan(workspace.projectRoot, 'demo');
    expect(reloaded.link ?? reloaded.changes[0].link).toBeNull();
    expect(reloaded.revision).toBe(4);
  });

  it('é idempotente: a segunda passada não muda nada', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'packaging');
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'packaging' })] })
    );
    const first = await syncPlan(workspace, 'demo', { link: true });
    const second = await syncPlan(workspace, 'demo', { link: true });
    expect(first.linked).toHaveLength(1);
    expect(second.linked).toEqual([]);
    expect(second.revision).toBe(first.revision);
  });

  it('nunca rouba um nome que outro incremento já reivindicou', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'auth');
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({
            id: 'CH-001',
            slug: 'fundacao',
            link: { name: 'auth', active_path: 'spec/changes/auth', archive_path: null, linked_at: '2026-09-01' },
          }),
          change({ id: 'CH-002', slug: 'auth' }),
        ],
      })
    );
    const result = await syncPlan(workspace, 'demo', { link: true });
    expect(result.linked).toEqual([]);
  });

  it('não vincula um incremento cancelado', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'descartado');
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [change({ id: 'CH-001', slug: 'descartado', planning_state: 'cancelled' })],
      })
    );
    expect((await syncPlan(workspace, 'demo', { link: true })).linked).toEqual([]);
  });
});

