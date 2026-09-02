import { PRIORITY_RANK } from './state.js';
import type { PlanStatus, ProjectChangeView } from './status.js';
import type { Priority } from './model.js';

export interface NextCandidate {
  id: string;
  slug: string;
  title: string;
  priority: string;
  milestone: string | null;
  plannedChange: string | null;
  reasonCodes: string[];
  unlocks: string[];
}

export interface ExcludedChange {
  id: string;
  readiness: string;
  execution: string;
  reasonCodes: string[];
  blockedBy: string[];
}

export interface NextRecommendation {
  plan: string;
  recommended: (NextCandidate & { startWith: string; thenLink: string }) | null;
  alternatives: NextCandidate[];
  parallelReady: string[];
  parallelCaveat: string;
  excluded: ExcludedChange[];
}

const CAVEAT =
  'prontas por dependência declarada; o core não prova ausência de conflito de código';

export function recommendNext(status: PlanStatus): NextRecommendation {
  const { graph, manifest } = status;
  const declarationIndex = new Map(manifest.changes.map((change, index) => [change.id, index]));
  const milestoneOrder = new Map(manifest.milestones.map((milestone) => [milestone.id, milestone.order]));

  const rank = (view: ProjectChangeView) => ({
    priority: PRIORITY_RANK[view.priority as Priority] ?? 0,
    unlockCount: graph.descendants(view.id).length,
    directUnlockCount: graph.dependents(view.id).length,
    milestoneOrder: view.milestone ? milestoneOrder.get(view.milestone) ?? Infinity : Infinity,
    declaration: declarationIndex.get(view.id) ?? 0,
  });

  // Eligible = ready AND not already delivered. `readiness` keeps being computed
  // for an archived increment (§7.6, cenário D), so filtering on it alone would
  // recommend work that is already done (§7.8, passo 3).
  const isEligible = (view: ProjectChangeView) =>
    view.readiness === 'ready' && view.execution !== 'archived';

  const eligible = status.changes
    .filter(isEligible)
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return (
        rb.priority - ra.priority ||
        rb.unlockCount - ra.unlockCount ||
        rb.directUnlockCount - ra.directUnlockCount ||
        ra.milestoneOrder - rb.milestoneOrder ||
        ra.declaration - rb.declaration
      );
    });

  const toCandidate = (view: ProjectChangeView): NextCandidate => ({
    id: view.id,
    slug: view.slug,
    title: view.title,
    priority: view.priority,
    milestone: view.milestone,
    plannedChange: view.plannedChange ? `${status.plan.path}/${view.plannedChange.path}` : null,
    reasonCodes: view.readinessReasons,
    unlocks: graph.descendants(view.id),
  });

  const [top, ...rest] = eligible;

  const excluded: ExcludedChange[] = status.changes
    .filter((view) => !isEligible(view))
    .map((view) => ({
      id: view.id,
      readiness: view.readiness,
      execution: view.execution,
      // An archived increment is excluded because it is done, not because it is
      // blocked; say that instead of repeating its readiness reasons.
      reasonCodes: view.execution === 'archived' ? ['archive_resolved'] : view.readinessReasons,
      blockedBy: view.execution === 'archived' ? [] : view.blockedBy,
    }));

  return {
    plan: status.plan.id,
    recommended: top
      ? {
          ...toCandidate(top),
          startWith: `specs new change ${top.slug}`,
          thenLink: `specs project link ${top.id} ${top.slug}`,
        }
      : null,
    alternatives: rest.slice(0, 5).map(toCandidate),
    parallelReady: eligible.map((view) => view.id),
    parallelCaveat: CAVEAT,
    excluded,
  };
}
