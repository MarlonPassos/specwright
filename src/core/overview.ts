import { buildDashboard, type DashboardData, type DashboardOptions } from './dashboard.js';
import { listPlanIds } from './project/paths.js';
import { computeProjectStatus, type PlanStatus } from './project/status.js';
import { recommendNext } from './project/next.js';
import type { Workspace } from './workspace.js';

/** One piece of work in flight, seen from both layers at once. */
export interface OverviewFocus {
  /** The native change, when one is active. */
  change?: {
    id: string;
    phase: string;
    tasks?: { total: number; completed: number };
    /** The command that moves it forward, spelled for the running harness. */
    next: string;
  };
  /** The increment linked to it, when the plan carries one. */
  increment?: {
    id: string;
    title: string;
    milestone: string | null;
    presentation: string;
    unlocks: string[];
    /** Materialization state of the brief, when there is one. */
    brief: string | null;
  };
}

export interface OverviewData {
  projectName: string;
  schema: string;
  harness: string;
  /** Absent in a project with no `planning/`, or whose plan will not load. */
  plan?: { id: string; name: string; revision: number; derivedStatus: string };
  changes: {
    active: number;
    readyToArchive: number;
    archived: number;
    tasks: { total: number; completed: number };
    capabilities: number;
    requirements: number;
  };
  increments?: {
    total: number;
    archived: number;
    ready: number;
    blocked: number;
    inProgress: number;
    percent: number;
  };
  /** Work in flight, plan and execution joined. Empty when nothing is running. */
  focus: OverviewFocus[];
  milestones?: { id: string; name: string; archived: number; total: number }[];
  recommended?: { id: string; title: string; reasons: string[]; commands: string[] };
  diagnostics: { errors: number; warnings: number };
}

export interface OverviewOptions extends DashboardOptions {
  /** Plan to read. Defaults to the only one, when exactly one exists. */
  planId?: string;
}

/**
 * The two dashboards, projected onto one screen.
 *
 * The join is `link.name`: a Project Change's link carries the DIRECTORY name of
 * the native change, which is exactly `DashboardChange.id`. That edge already
 * exists in the data and has never been drawn — the reader had to know that
 * `fund-refactor` and `CH-019` were the same work.
 *
 * Fail-soft about the plan, by the same rule `adviseLink` follows: no planning
 * area, an unreadable manifest or several plans with no explicit id leave every
 * plan-side field absent, and the execution side is projected on its own. A
 * broken plan must never cost the reader the half of the screen that still works.
 */
export async function buildOverview(
  workspace: Workspace,
  options: OverviewOptions = {}
): Promise<OverviewData> {
  const dashboard = await buildDashboard(workspace, options);
  const status = await loadPlanStatus(workspace, options.planId);

  const active = dashboard.changes.filter(
    (change) => change.phase === 'planning' || change.phase === 'implementing'
  );
  const readyToArchive = dashboard.changes.filter((change) => change.phase === 'ready-to-archive');

  const base: OverviewData = {
    projectName: dashboard.projectName,
    schema: dashboard.schema,
    harness: dashboard.harness,
    changes: {
      active: active.length,
      readyToArchive: readyToArchive.length,
      archived: dashboard.archive.count,
      tasks: dashboard.totals.tasks,
      capabilities: dashboard.specs.length,
      requirements: dashboard.totals.requirements,
    },
    focus: [],
    diagnostics: { errors: 0, warnings: 0 },
  };

  if (!status) {
    return { ...base, focus: focusFromChanges(dashboard) };
  }

  const next = recommendNext(status);

  return {
    ...base,
    plan: {
      id: status.plan.id,
      name: status.plan.name,
      revision: status.plan.revision,
      derivedStatus: status.plan.derivedStatus,
    },
    increments: {
      total: status.progress.total,
      archived: status.progress.archived,
      ready: status.progress.ready,
      blocked: status.progress.blocked,
      inProgress: status.progress.inProgress,
      percent: status.progress.percent,
    },
    focus: joinFocus(dashboard, status),
    milestones: status.milestones.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      archived: milestone.archived,
      total: milestone.changes.length,
    })),
    ...(next.recommended
      ? {
          recommended: {
            id: next.recommended.id,
            title: next.recommended.title,
            reasons: next.recommended.reasonCodes,
            commands: [next.recommended.startWith, next.recommended.thenLink].filter(
              (command): command is string => Boolean(command)
            ),
          },
        }
      : {}),
    diagnostics: {
      errors: status.diagnostics.filter((issue) => issue.level === 'ERROR').length,
      warnings: status.diagnostics.filter((issue) => issue.level === 'WARNING').length,
    },
  };
}

async function loadPlanStatus(
  workspace: Workspace,
  planId?: string
): Promise<PlanStatus | undefined> {
  try {
    const ids = await listPlanIds(workspace.projectRoot);
    const id = planId ?? (ids.length === 1 ? ids[0] : undefined);
    if (id === undefined || !ids.includes(id)) return undefined;
    return await computeProjectStatus(workspace, id);
  } catch {
    return undefined;
  }
}

/** Execution alone: every change in flight, with no increment beside it. */
function focusFromChanges(dashboard: DashboardData): OverviewFocus[] {
  return dashboard.changes
    .filter((change) => change.phase !== 'ready-to-archive')
    .map((change) => ({ change: changeSide(change) }));
}

function changeSide(change: DashboardData['changes'][number]): NonNullable<OverviewFocus['change']> {
  return {
    id: change.id,
    phase: change.phase,
    ...(change.tasks ? { tasks: change.tasks } : {}),
    next: change.next,
  };
}

/**
 * Pairs by `link.name`, then reports what is left over on each side.
 *
 * The leftovers are the point as much as the pairs: an increment reported as
 * being implemented with no change behind it is work that was never linked, and
 * a change with no increment is work the plan does not know about. Both were
 * invisible while the two dashboards stood apart.
 */
function joinFocus(dashboard: DashboardData, status: PlanStatus): OverviewFocus[] {
  const inFlight = dashboard.changes.filter((change) => change.phase !== 'ready-to-archive');
  const byName = new Map(inFlight.map((change) => [change.id, change]));
  const paired = new Set<string>();
  const focus: OverviewFocus[] = [];

  for (const view of status.changes) {
    const change = view.link ? byName.get(view.link.name) : undefined;
    const running = view.execution === 'in_progress' || view.execution === 'proposed';
    if (!change && !running) continue;
    if (change) paired.add(change.id);

    focus.push({
      ...(change ? { change: changeSide(change) } : {}),
      increment: {
        id: view.id,
        title: view.title,
        milestone: view.milestone,
        presentation: view.presentation,
        unlocks: view.unlocks,
        brief: view.plannedChange ? view.plannedChange.state : null,
      },
    });
  }

  for (const change of inFlight) {
    if (paired.has(change.id)) continue;
    focus.push({ change: changeSide(change) });
  }

  return focus;
}
