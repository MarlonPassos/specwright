import { buildDashboard } from '../core/dashboard.js';
import { buildOverview } from '../core/overview.js';
import { computeProjectStatus } from '../core/project/status.js';
import { recommendNext } from '../core/project/next.js';
import { listPlanIds } from '../core/project/paths.js';
import type { Workspace } from '../core/workspace.js';
import { renderDashboard } from './dashboard-view.js';
import { renderOverview } from './overview-view.js';
import { renderProjectDashboard } from './project-dashboard-view.js';
import type { ViewOptions } from './theme.js';
import { runTabbedWatch, type Tab } from './tui.js';

/** Tab ids, also the values the entry points pass as their starting screen. */
export const OVERVIEW_TAB = 'overview';
export const CHANGES_TAB = 'changes';
export const PLAN_TAB = 'plan';

export interface PanelOptions {
  initial: string;
  intervalMs: number;
  view: ViewOptions;
  /** Plan to read; defaults to the only one. */
  planId?: string;
}

/**
 * The tabs a project can offer.
 *
 * A project with no readable plan gets exactly one tab, so `specs status
 * --watch` there stays the single screen it has always been — no bar, no keys,
 * nothing new to learn for a workspace that never opted into planning. The
 * overview tab goes with it: without a plan there is no join to draw, and the
 * screen would just be a thinner CHANGES.
 */
export async function buildTabs(
  workspace: Workspace,
  view: ViewOptions,
  planId?: string
): Promise<Tab[]> {
  const width = (): number => process.stdout.columns ?? view.width;
  const changes: Tab = {
    id: CHANGES_TAB,
    label: 'CHANGES',
    command: 'specs status',
    frame: async () => renderDashboard(await buildDashboard(workspace), { ...view, width: width() }),
  };

  const id = await resolvePlan(workspace, planId);
  if (id === undefined) return [changes];

  const overview: Tab = {
    id: OVERVIEW_TAB,
    label: 'RESUMO',
    command: 'specs watch',
    frame: async () =>
      renderOverview(await buildOverview(workspace, { planId: id }), { ...view, width: width() }),
  };

  const plan: Tab = {
    id: PLAN_TAB,
    label: 'PLANO',
    command: 'specs project',
    frame: async () => {
      const status = await computeProjectStatus(workspace, id);
      return renderProjectDashboard(status, recommendNext(status), { ...view, width: width() });
    },
  };

  return [overview, changes, plan];
}

export async function runPanel(workspace: Workspace, options: PanelOptions): Promise<void> {
  const tabs = await buildTabs(workspace, options.view, options.planId);
  await runTabbedWatch({
    tabs,
    initial: options.initial,
    intervalMs: options.intervalMs,
    view: options.view,
  });
}

/**
 * Which plan the panel reads, or `undefined` when there is nothing to read.
 *
 * Fail-soft on purpose, like `buildOverview`: several plans with no explicit id,
 * or a directory that cannot be listed, is not an error here — it is a project
 * that gets the single-tab panel.
 */
async function resolvePlan(workspace: Workspace, planId?: string): Promise<string | undefined> {
  try {
    const ids = await listPlanIds(workspace.projectRoot);
    if (planId !== undefined) return ids.includes(planId) ? planId : undefined;
    return ids.length === 1 ? ids[0] : undefined;
  } catch {
    return undefined;
  }
}
