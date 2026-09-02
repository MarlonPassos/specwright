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
