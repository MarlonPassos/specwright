import { readFileIfExists, writeFileAtomic } from '../../util/fs.js';
import type { Workspace } from '../workspace.js';
import { planPaths } from './paths.js';
import { assertRoadmapMarkers, renderRoadmapBlock, spliceRoadmap } from './render.js';
import { computeProjectStatus, roadmapRows } from './status.js';

/**
 * Rewrites the projected roadmap block in `plan.md` from the current manifest.
 *
 * `plan.md` is a materialised projection, and it used to be re-emitted from
 * exactly two places — `apply` and `generate`. Every OTHER path that bumps the
 * revision (`link`, `unlink`, `adopt`, `set-state`, `sync`, and `archive`
 * through the link it closes) left the block behind, so the one artefact a
 * human reads without running the CLI drifted: a roadmap declaring five
 * increments blocked while `status` correctly reported the milestone complete.
 * Fixing only `link` would have left four doors open.
 *
 * Fail-soft on purpose, and it returns what it did rather than throwing. A
 * missing `plan.md`, unbalanced markers or a read-only file must never turn a
 * successful `link` into a failed command: the projection is downstream of the
 * record, exactly as the plan is downstream of the work. `stale_projection`
 * reports whatever this could not fix.
 *
 * `apply` and `generate` keep their own inline projection: they read the human
 * document INSIDE the plan lock, so a concurrent editor cannot be overwritten
 * by bytes read before the lock was acquired (R-01). This helper runs after the
 * write, where that guarantee no longer applies and is not needed.
 */
export async function reprojectRoadmap(
  workspace: Workspace,
  planId: string
): Promise<{ reprojected: boolean; reason?: string }> {
  try {
    const paths = planPaths(workspace.projectRoot, planId);
    const before = await readFileIfExists(paths.planDoc);
    if (before === undefined) return { reprojected: false, reason: 'plan.md ausente' };
    assertRoadmapMarkers(before);

    const status = await computeProjectStatus(workspace, planId);
    const block = renderRoadmapBlock({ manifest: status.manifest, rows: roadmapRows(status) });
    const after = spliceRoadmap(before, block);
    if (after === before) return { reprojected: false, reason: 'já atualizado' };

    await writeFileAtomic(paths.planDoc, after);
    return { reprojected: true };
  } catch (error) {
    return { reprojected: false, reason: (error as Error).message };
  }
}
