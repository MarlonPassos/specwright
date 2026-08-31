import path from 'node:path';
import { loadConfig, type WorkspaceConfig } from './config.js';
import { detectHarness } from './harness/current.js';
import type { HarnessAdapter } from './harness/types.js';
import { listSpecEntries } from './list.js';
import { computeStatus, resolveChangeContext, type ArtifactState } from './change/status.js';
import { listArchivedChanges, listChanges, type Workspace } from './workspace.js';

/** Where a change sits in the workflow, derived from its artifacts and tasks. */
export type ChangePhase = 'planning' | 'implementing' | 'ready-to-archive' | 'broken';

export interface DashboardArtifact {
  id: string;
  state: ArtifactState;
}

export interface DashboardChange {
  id: string;
  phase: ChangePhase;
  artifacts: DashboardArtifact[];
  blockedBy: string[];
  tasks?: { total: number; completed: number };
  /** The command that moves this change forward. */
  next: string;
  /** Why the change could not be read at all; set only when the phase is `broken`. */
  error?: string;
}

export interface DashboardData {
  projectName: string;
  workspace: string;
  schema: string;
  /** The harness the commands in this dashboard are spelled for. */
  harness: string;
  changes: DashboardChange[];
  specs: { capability: string; requirements: number }[];
  archive: { count: number; last?: string };
  totals: {
    tasks: { total: number; completed: number };
    requirements: number;
  };
}

/** Leading `<date>-` of an archived change directory, which is how it is stamped. */
function archiveDate(id: string): string | undefined {
  return /^(\d{4}-\d{2}-\d{2})-/.exec(id)?.[1];
}

function phaseOf(
  blockedBy: string[],
  tasks: { total: number; completed: number } | undefined
): ChangePhase {
  if (blockedBy.length > 0) return 'planning';
  if (tasks && tasks.total > 0 && tasks.completed >= tasks.total) return 'ready-to-archive';
  return 'implementing';
}

/**
 * The command that moves a change forward, typed the way the running harness
 * accepts it - never a slash command in a harness that has no slash commands.
 */
function nextCommand(phase: ChangePhase, harness: HarnessAdapter): string {
  switch (phase) {
    case 'planning':
      return harness.invocation('plan');
    case 'implementing':
      return harness.invocation('implement');
    case 'ready-to-archive':
      return harness.invocation('archive');
    default:
      return 'specs validate';
  }
}

async function readChange(
  workspace: Workspace,
  id: string,
  harness: HarnessAdapter
): Promise<DashboardChange> {
  try {
    const context = await resolveChangeContext(workspace, id);
    const status = await computeStatus(context);
    const phase = phaseOf(status.applyBlockedBy, status.tasks);

    return {
      id,
      phase,
      artifacts: status.artifacts.map((artifact) => ({ id: artifact.id, state: artifact.state })),
      blockedBy: status.applyBlockedBy,
      ...(status.tasks ? { tasks: status.tasks } : {}),
      next: nextCommand(phase, harness),
    };
  } catch (error) {
    // One unreadable change must not blank the whole dashboard, which in watch
    // mode would be the only thing on screen.
    return {
      id,
      phase: 'broken',
      artifacts: [],
      blockedBy: [],
      next: nextCommand('broken', harness),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface DashboardOptions {
  /** Where the running harness is read from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** Everything the dashboard renders, gathered in one pass over the workspace. */
export async function buildDashboard(
  workspace: Workspace,
  options: DashboardOptions = {}
): Promise<DashboardData> {
  const config = await loadConfig(workspace).catch(() => ({ schema: 'spec-driven' }) as WorkspaceConfig);
  const harness = detectHarness({ ...(options.env ? { env: options.env } : {}), configured: config.harnesses });
  const ids = await listChanges(workspace);
  const changes: DashboardChange[] = [];
  for (const id of ids) changes.push(await readChange(workspace, id, harness));

  const specs = (await listSpecEntries(workspace).catch(() => [])).map((entry) => ({
    capability: entry.capability,
    requirements: entry.requirements,
  }));

  const archived = await listArchivedChanges(workspace).catch(() => [] as string[]);
  const dates = archived.map(archiveDate).filter((date): date is string => Boolean(date)).sort();

  const tasks = changes.reduce(
    (total, change) => ({
      total: total.total + (change.tasks?.total ?? 0),
      completed: total.completed + (change.tasks?.completed ?? 0),
    }),
    { total: 0, completed: 0 }
  );

  return {
    projectName: path.basename(workspace.projectRoot),
    workspace: workspace.root,
    schema: config.schema ?? 'spec-driven',
    harness: harness.id,
    changes,
    specs,
    archive: { count: archived.length, ...(dates.length > 0 ? { last: dates[dates.length - 1] } : {}) },
    totals: {
      tasks,
      requirements: specs.reduce((total, spec) => total + spec.requirements, 0),
    },
  };
}
