import { describe, expect, it } from 'vitest';
import { computeParallelImplementBatch } from '../../src/core/project/parallelImplement.js';
import { computeProjectStatus } from '../../src/core/project/status.js';
import { activePath } from '../../src/core/project/link.js';
import { makePlanWorkspace, seedPlan, manifest, change, withBrief } from '../helpers/plan.js';
import { seedChange } from '../helpers/workspace.js';
import type { Workspace } from '../../src/core/workspace.js';
import type { ChangeLink, ProjectChange } from '../../src/core/project/model.js';

function linkTo(name: string): ChangeLink {
  return { name, active_path: activePath(name), archive_path: null, linked_at: '2024-01-01' };
}

/** A ready, proposed, linked change - the baseline every scenario tweaks. */
async function readyProposedChange(
  workspace: Workspace,
  planId: string,
  input: { id: string; slug: string; priority?: ProjectChange['priority'] },
  changeOverrides: Parameters<typeof seedChange>[2] = {}
): Promise<ProjectChange> {
  await seedChange(workspace, input.slug, changeOverrides);
  const base = await withBrief(workspace, planId, change({ id: input.id, slug: input.slug, priority: input.priority }));
  return { ...base, link: linkTo(input.slug) };
}

describe('computeParallelImplementBatch', () => {
  it('batches two ready, proposed changes that touch different capabilities', async () => {
    const workspace = await makePlanWorkspace();
    const a = await readyProposedChange(workspace, 'demo', { id: 'CH-001', slug: 'alpha' }, { capability: 'cap-a' });
    const b = await readyProposedChange(workspace, 'demo', { id: 'CH-002', slug: 'beta' }, { capability: 'cap-b' });
    await seedPlan(workspace, manifest({ id: 'demo', changes: [a, b] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeParallelImplementBatch(workspace, status);

    expect(result.batch.map((entry) => entry.id).sort()).toEqual(['CH-001', 'CH-002']);
    expect(result.excluded).toEqual([]);
  });

  it('excludes the lower-priority change when two ready, proposed changes share a capability', async () => {
    const workspace = await makePlanWorkspace();
    const a = await readyProposedChange(
      workspace,
      'demo',
      { id: 'CH-001', slug: 'alpha', priority: 'high' },
      { capability: 'shared-cap' }
    );
    const b = await readyProposedChange(
      workspace,
      'demo',
      { id: 'CH-002', slug: 'beta', priority: 'critical' },
      { capability: 'shared-cap' }
    );
    await seedPlan(workspace, manifest({ id: 'demo', changes: [a, b] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeParallelImplementBatch(workspace, status);

    // critical outranks high, so CH-002 wins the capability and CH-001 sits out.
    expect(result.batch.map((entry) => entry.id)).toEqual(['CH-002']);
    expect(result.excluded).toEqual([{ id: 'CH-001', reason: 'capability_conflict:shared-cap' }]);
  });

  it('always includes a --skip-specs change: no capability means no conflict', async () => {
    const workspace = await makePlanWorkspace();
    const skipSpecs = await readyProposedChange(
      workspace,
      'demo',
      { id: 'CH-001', slug: 'alpha' },
      { delta: null as unknown as string }
    );
    const withCap = await readyProposedChange(
      workspace,
      'demo',
      { id: 'CH-002', slug: 'beta' },
      { capability: 'cap-b' }
    );
    await seedPlan(workspace, manifest({ id: 'demo', changes: [skipSpecs, withCap] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeParallelImplementBatch(workspace, status);

    expect(result.batch.map((entry) => entry.id).sort()).toEqual(['CH-001', 'CH-002']);
  });

  it('excludes a change blocked by an unmet dependency', async () => {
    const workspace = await makePlanWorkspace();
    const a = await readyProposedChange(workspace, 'demo', { id: 'CH-001', slug: 'alpha' });
    const bBase = await readyProposedChange(workspace, 'demo', { id: 'CH-002', slug: 'beta' });
    const b = { ...bBase, depends_on: ['CH-001'] };
    await seedPlan(workspace, manifest({ id: 'demo', changes: [a, b] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeParallelImplementBatch(workspace, status);

    expect(result.batch.map((entry) => entry.id)).toEqual(['CH-001']);
    expect(result.excluded).toEqual([{ id: 'CH-002', reason: 'readiness_blocked' }]);
  });

  it('excludes a ready change that was never linked to a real change directory', async () => {
    const workspace = await makePlanWorkspace();
    const unlinked = await withBrief(workspace, 'demo', change({ id: 'CH-001', slug: 'alpha' }));
    await seedPlan(workspace, manifest({ id: 'demo', changes: [unlinked] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeParallelImplementBatch(workspace, status);

    expect(result.batch).toEqual([]);
    expect(result.excluded).toEqual([{ id: 'CH-001', reason: 'not_linked' }]);
  });

  it('excludes a change that already has implementation started (execution beyond "proposed")', async () => {
    const workspace = await makePlanWorkspace();
    const started = await readyProposedChange(
      workspace,
      'demo',
      { id: 'CH-001', slug: 'alpha' },
      { tasks: '- [x] 1.1 Já feito `files: a.ts`\n- [ ] 1.2 Falta `files: b.ts`\n' }
    );
    await seedPlan(workspace, manifest({ id: 'demo', changes: [started] }));

    const status = await computeProjectStatus(workspace, 'demo');
    const result = await computeParallelImplementBatch(workspace, status);

    expect(result.batch).toEqual([]);
    expect(result.excluded).toEqual([{ id: 'CH-001', reason: 'execution_in_progress' }]);
  });
});
