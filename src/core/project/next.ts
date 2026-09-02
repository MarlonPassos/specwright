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

  const eligible = status.changes
    .filter((view) => view.readiness === 'ready')
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
    .filter((view) => view.readiness !== 'ready')
    .map((view) => ({
      id: view.id,
      readiness: view.readiness,
      reasonCodes: view.readinessReasons,
      blockedBy: view.blockedBy,
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
