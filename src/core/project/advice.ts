import { listPlanIds } from './paths.js';
import { loadPlan } from './repository.js';

export interface LinkAdvice {
  /** Plan that carries the increment. */
  plan: string;
  /** Increment id, e.g. `CH-018`. */
  change: string;
  slug: string;
  title: string;
  /** The exact command that records the link. */
  fix: string;
}

/**
 * Whether some plan already carries an increment for this change name and has
 * not linked it yet.
 *
 * The plan is never written here, and no link is inferred: this only reports a
 * command the user may run, which keeps the explicit-link rule intact (§7.10).
 * It exists because the gap it covers is silent — a change created with the
 * slug of a planned increment, worked and archived, never reaches the plan, and
 * nothing along the way says so.
 *
 * Fail-soft by construction: no planning area, or a plan that will not load,
 * answers `undefined`. A workspace command must behave the same with a broken
 * plan as with no plan at all (AC-51).
 */
export async function adviseLink(
  projectRoot: string,
  changeName: string
): Promise<LinkAdvice | undefined> {
  let planIds: string[];
  try {
    planIds = await listPlanIds(projectRoot);
  } catch {
    return undefined;
  }
  if (planIds.length === 0) return undefined;

  for (const planId of planIds) {
    let advice: LinkAdvice | undefined;
    try {
      const { manifest } = await loadPlan(projectRoot, planId);
      const change = manifest.changes.find(
        (entry) =>
          entry.slug === changeName && !entry.link && entry.planning_state !== 'cancelled'
      );
      if (!change) continue;
      // `specs project link` takes the plan id as an optional first positional.
      // It is only needed to disambiguate, so it is spelled out only then.
      const target = planIds.length > 1 ? `${planId} ${change.id}` : change.id;
      advice = {
        plan: planId,
        change: change.id,
        slug: change.slug,
        title: change.title,
        fix: `specs project link ${target} ${change.slug}`,
      };
    } catch {
      continue;
    }
    return advice;
  }

  return undefined;
}
