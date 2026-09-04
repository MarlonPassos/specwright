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

export interface LinkAdviceSet {
  /** Every increment that could claim this change name: 0, 1 or several. */
  candidates: LinkAdvice[];
  /** More than one candidate: nobody may pick for the user. */
  ambiguous: boolean;
}

/**
 * Which plans already carry an increment for this change name and have not
 * linked it yet.
 *
 * The plan is never written here, and no link is inferred: this only reports a
 * command the user may run, which keeps the explicit-link rule intact (§7.10).
 * It exists because the gap it covers is silent — a change created with the
 * slug of a planned increment, worked and archived, never reaches the plan, and
 * nothing along the way says so.
 *
 * EVERY candidate is returned, not the first one found. The old contract was
 * zero-or-one and stopped at the first match, so with two plans carrying the
 * same free slug the archive wrote the link into whichever plan directory
 * sorted first, and nothing anywhere said a second candidate existed (F-02).
 * The §7.10 exception exists to CLOSE a link the plan already foresaw, not to
 * decide which plan the work belongs to.
 *
 * Fail-soft by construction: no planning area, or a plan that will not load,
 * contributes no candidate. A workspace command must behave the same with a
 * broken plan as with no plan at all (AC-51).
 */
export async function adviseLink(
  projectRoot: string,
  changeName: string
): Promise<LinkAdviceSet> {
  const empty: LinkAdviceSet = { candidates: [], ambiguous: false };
  let planIds: string[];
  try {
    planIds = await listPlanIds(projectRoot);
  } catch {
    return empty;
  }
  if (planIds.length === 0) return empty;

  const candidates: LinkAdvice[] = [];
  for (const planId of planIds) {
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
      candidates.push({
        plan: planId,
        change: change.id,
        slug: change.slug,
        title: change.title,
        fix: `specs project link ${target} ${change.slug}`,
      });
    } catch {
      continue;
    }
  }

  return { candidates, ambiguous: candidates.length > 1 };
}

/** The single candidate, or `undefined` when there is none or more than one. */
export function soleCandidate(advice: LinkAdviceSet): LinkAdvice | undefined {
  return advice.candidates.length === 1 ? advice.candidates[0] : undefined;
}
