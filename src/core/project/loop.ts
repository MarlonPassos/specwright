import { computeStatus, resolveChangeContext } from '../change/status.js';
import { hasRegisteredWorktree } from '../change/worktree.js';
import type { Workspace } from '../workspace.js';
import { SpecError } from '../../util/errors.js';
import { recommendNext } from './next.js';
import { computeProjectStatus, type DiagnosticView } from './status.js';

export type LoopAction = 'link' | 'propose' | 'continue' | 'implement' | 'verify';

export interface LoopCandidate {
  id: string;
  slug: string;
  change: string;
  title: string;
  action: LoopAction;
  plannedChange: string | null;
  dependsOn: string[];
  unlocks: string[];
}

export interface LoopBlocker {
  id: string | null;
  reasonCodes: string[];
  blockedBy: string[];
  manualBlockers: string[];
}

export interface LoopSnapshot {
  loopSchemaVersion: 1;
  plan: { id: string; revision: number };
  state: 'ready' | 'completed' | 'blocked';
  completed: string[];
  cancelled: string[];
  remaining: string[];
  candidates: LoopCandidate[];
  recommended: string | null;
  blockers: LoopBlocker[];
  diagnostics: DiagnosticView[];
}

/**
 * Read-only frontier for an explicitly invoked spec-loop. No execution flag is
 * persisted: inspecting this projection never starts an agent or authorizes work.
 * Native artifacts/checklists decide the next phase; `verifying` is not proof
 * of verification. Only the existing archive evidence closes a graph node.
 */
export async function computeLoopSnapshot(workspace: Workspace, planId: string): Promise<LoopSnapshot> {
  const status = await computeProjectStatus(workspace, planId);
  const candidates: LoopCandidate[] = [];
  const blockers: LoopBlocker[] = [];
  const completed: string[] = [];
  const cancelled: string[] = [];
  const remaining: string[] = [];
  const diagnosticsFor = (id: string) => status.diagnostics.filter((entry) => {
    const [root, ids] = entry.path.split('.');
    return root === 'changes' && ids?.split(',').includes(id) &&
      (entry.level === 'ERROR' || ['ambiguous_execution', 'ambiguous_archive_match'].includes(entry.code));
  });
  const worktrees = new Set<string>();
  for (const view of status.changes) {
    if (await hasRegisteredWorktree(workspace.projectRoot, view.link?.name ?? view.slug)) worktrees.add(view.id);
  }
  const uncertainArchives = new Set(status.changes
    .filter((view) => view.execution === 'archived' && (diagnosticsFor(view.id).length > 0 || worktrees.has(view.id)))
    .map((view) => view.id));

  const block = (id: string | null, reasonCodes: string[], blockedBy: string[] = [], manualBlockers: string[] = []) => {
    blockers.push({ id, reasonCodes, blockedBy, manualBlockers });
  };

  const runnablePlan = status.plan.status === 'active' || status.plan.status === 'completed';
  if (!runnablePlan) block(null, [`plan_${status.plan.status}`]);
  if (status.changes.length === 0) block(null, ['empty_plan']);

  for (const view of status.changes) {
    // Ambiguous archive evidence must not turn live work into a completed node.
    const diagnostics = diagnosticsFor(view.id);
    if (view.planningState === 'cancelled') {
      cancelled.push(view.id);
      continue;
    }
    if (view.execution === 'archived' && diagnostics.length === 0 && !worktrees.has(view.id)) {
      completed.push(view.id);
      continue;
    }
    remaining.push(view.id);
    if (diagnostics.length > 0) {
      block(view.id, diagnostics.map((entry) => entry.code));
      continue;
    }
    if (view.planningState !== 'planned') {
      block(view.id, [`state_${view.planningState}`]);
      continue;
    }

    const name = view.link?.name ?? view.slug;
    const claimed = status.changes.find((other) => other.id !== view.id && other.link?.name === name);
    if (claimed) {
      block(view.id, [`slug_claimed_by:${claimed.id}`]);
      continue;
    }
    const active = status.workspaceChanges.active.has(name);
    const archived = status.workspaceChanges.archivedSlugs.has(name);
    if (active && archived) {
      block(view.id, ['ambiguous_execution']);
      continue;
    }
    if (worktrees.has(view.id)) {
      block(view.id, ['worktree_active']);
      continue;
    }

    let action: LoopAction;
    // Reconcile an exact existing identity first, even if dependencies are still
    // pending. Linking does not authorize implementing before readiness.
    if (!view.link && (active || archived)) {
      action = 'link';
    } else if (view.readiness !== 'ready') {
      block(view.id, view.readinessReasons, view.blockedBy, view.manualBlockers);
      continue;
    } else if (status.graph.ancestors(view.id).some((id) => uncertainArchives.has(id))) {
      block(view.id, ['dependency_execution_uncertain'], status.graph.ancestors(view.id).filter((id) => uncertainArchives.has(id)));
      continue;
    } else if (view.execution === 'unknown') {
      block(view.id, ['execution_unknown']);
      continue;
    } else if (!view.link) {
      action = 'propose';
    } else {
      try {
        const native = await computeStatus(await resolveChangeContext(workspace, name));
        action = !native.ready || native.next.length > 0
          ? 'continue'
          : native.tasks && native.tasks.completed < native.tasks.total
            ? 'implement'
            : 'verify';
      } catch (error) {
        block(view.id, [error instanceof SpecError ? error.code : 'native_status_unreadable']);
        continue;
      }
    }
    if (runnablePlan) {
      candidates.push({
        id: view.id,
        slug: view.slug,
        change: name,
        title: view.title,
        action,
        plannedChange: view.plannedChange ? `${status.plan.path}/${view.plannedChange.path}` : null,
        dependsOn: view.dependsOn,
        unlocks: status.graph.descendants(view.id),
      });
    }
  }

  // Ranking remains advisory. All eligible choices are exposed to the agent.
  const ranked = recommendNext(status).parallelReady;
  const recommended = ranked.find((id) => candidates.some((entry) => entry.id === id)) ?? candidates[0]?.id ?? null;
  return {
    loopSchemaVersion: 1,
    plan: { id: status.plan.id, revision: status.plan.revision },
    state: runnablePlan && status.changes.length > 0 && remaining.length === 0
      ? 'completed'
      : candidates.length > 0 ? 'ready' : 'blocked',
    completed,
    cancelled,
    remaining,
    candidates,
    recommended,
    blockers,
    diagnostics: status.diagnostics,
  };
}
