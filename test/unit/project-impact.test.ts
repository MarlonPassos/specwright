import { describe, expect, it } from 'vitest';
import { computeImpact } from '../../src/core/project/impact.js';
import {
  makePlanWorkspace,
  seedPlan,
  seedArchivedChange,
  manifest,
  change,
  withBrief,
} from '../helpers/plan.js';
import { seedChange } from '../helpers/workspace.js';

const link = (name: string) => ({
  name,
  active_path: `spec/changes/${name}`,
  archive_path: null,
  linked_at: '2026-09-01',
});

describe('computeImpact', () => {
  it('reports dependents, ancestors and milestones of the affected set', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        milestones: [
          { id: 'M1', name: 'Um', order: 1, changes: ['CH-001'] },
          { id: 'M2', name: 'Dois', order: 2, changes: ['CH-002', 'CH-003'] },
        ],
        changes: [
          change({ id: 'CH-001', slug: 'a', milestone: 'M1' }),
          change({ id: 'CH-002', slug: 'b', depends_on: ['CH-001'], milestone: 'M2' }),
          change({ id: 'CH-003', slug: 'c', depends_on: ['CH-002'], milestone: 'M2' }),
        ],
      })
    );
    const impact = await computeImpact(workspace, 'demo', ['CH-001']);
    expect(impact.dependents.sort()).toEqual(['CH-002', 'CH-003']);
    expect(impact.ancestors).toEqual([]);
    expect(impact.milestones.sort()).toEqual(['M1', 'M2']);
  });

  it('collects shared capabilities from linked changes and flags completed reached', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'auth', { capability: 'identity/user-auth' });
    await seedArchivedChange(workspace, 'foundation');
    const ch1 = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-001', slug: 'foundation', link: link('foundation') })
    );
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          ch1,
          change({ id: 'CH-002', slug: 'auth', depends_on: ['CH-001'], link: link('auth') }),
        ],
      })
    );
    const impact = await computeImpact(workspace, 'demo', ['CH-001']);
    expect(impact.completedReached).toEqual(['CH-001']);
    expect(impact.sharedCapabilities).toContain('identity/user-auth');
  });

  it('rejects an unknown target', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'a' })] }));
    await expect(computeImpact(workspace, 'demo', ['CH-099'])).rejects.toMatchObject({
      code: 'change_not_found',
    });
  });
});
