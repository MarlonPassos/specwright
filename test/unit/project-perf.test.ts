import { describe, expect, it } from 'vitest';
import { computeProjectStatus } from '../../src/core/project/status.js';
import { recommendNext } from '../../src/core/project/next.js';
import { generatePlannedChanges } from '../../src/core/project/generate.js';
import { makePlanWorkspace, seedPlan, manifest, change } from '../helpers/plan.js';

/** A 200-increment plan: ten milestones, each a short dependency chain. */
function largePlan() {
  const changes = [];
  const milestones = [];
  for (let m = 0; m < 10; m += 1) {
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const n = m * 20 + i + 1;
      const id = `CH-${String(n).padStart(3, '0')}`;
      ids.push(id);
      changes.push(
        change({
          id,
          slug: `inc-${n}`,
          title: `Incremento ${n}`,
          depends_on: i === 0 ? [] : [`CH-${String(n - 1).padStart(3, '0')}`],
          milestone: `M${m + 1}`,
        })
      );
    }
    milestones.push({ id: `M${m + 1}`, name: `Milestone ${m + 1}`, order: m + 1, changes: ids });
  }
  return manifest({ id: 'large', status: 'active', milestones, changes });
}

describe('performance targets (NFR-05, NFR-06, AC-35)', () => {
  it('status and next on 200 increments finish under 500ms', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, largePlan());

    const start = performance.now();
    const status = await computeProjectStatus(workspace, 'large');
    recommendNext(status);
    const elapsed = performance.now() - start;

    expect(status.changes).toHaveLength(200);
    expect(elapsed).toBeLessThan(500);
  });

  it('generate of 200 Planned Changes finishes under 2s', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, largePlan());

    const start = performance.now();
    const result = await generatePlannedChanges(workspace, 'large', {});
    const elapsed = performance.now() - start;

    expect(result.written).toHaveLength(200);
    expect(elapsed).toBeLessThan(2000);
  });
});
