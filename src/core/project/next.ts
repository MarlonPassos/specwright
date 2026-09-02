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

/**
 * How to start the recommended increment.
 *
 * `specs new change <slug>` was emitted unconditionally, so the panel told the
 * reader to create a change that already existed. Worse, when only an ARCHIVE
 * carried the slug the new directory was masked by it — `executionOf` resolves
 * the archive first, so the increment reported `concluída` the moment it was
 * linked, and the empty change became invisible.
 */
function startCommands(
  view: ProjectChangeView,
  status: PlanStatus
): { startWith: string; thenLink: string } {
  const link = `specs project link ${view.id} ${view.slug}`;
  const { active, archivedSlugs } = status.workspaceChanges;

  // Already linked: the work has a home. Point at it, not at linking it again.
  if (view.link) {
    return {
      startWith: `specs status --change ${view.link.name}`,
      thenLink: `specs archive ${view.link.name}`,
    };
  }

  const claimedByOther = new Set(
    status.changes.filter((other) => other.id !== view.id && other.link).map((other) => other.link!.name)
  );

  if (!claimedByOther.has(view.slug) && (active.has(view.slug) || archivedSlugs.has(view.slug))) {
    // The change already exists — active or archived. Link it; `link` resolves
    // both. Telling the reader to create it again produces an empty directory
    // that an archive of the same name then masks.
    return { startWith: link, thenLink: `specs status --change ${view.slug}` };
  }
  if (claimedByOther.has(view.slug)) {
    // Another increment owns that name; a fresh one is the only way forward.
    return {
      startWith: `specs new change ${view.slug}-2`,
      thenLink: `specs project link ${view.id} ${view.slug}-2`,
    };
  }
  return { startWith: `specs new change ${view.slug}`, thenLink: link };
}

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
    recommended: top ? { ...toCandidate(top), ...startCommands(top, status) } : null,
    alternatives: rest.slice(0, 5).map(toCandidate),
    parallelReady: eligible.map((view) => view.id),
    parallelCaveat: CAVEAT,
    excluded,
  };
}
