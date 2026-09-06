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

/** One increment a person has to unblock before the loop can pass it. */
export interface LoopTerminalBlocker {
  id: string;
  reasonCodes: string[];
  manualBlockers: string[];
  /** Remaining increments that stay out of reach because of this one. */
  blocks: string[];
}

/**
 * How far this loop can get before it needs a person.
 *
 * `state: 'blocked'` answers "is there anything to do RIGHT NOW", which is a
 * different question from "will this finish". Most of a plan is blocked at any
 * moment — `dependency_pending` is the normal condition of everything that has
 * not had its turn — so a snapshot full of blockers says nothing about whether
 * walking away is safe.
 *
 * This says it. The loop is meant to be started and left alone; discovering the
 * obstacle by hitting it costs a round trip per obstacle.
 *
 * A floor, never a promise: it reports what WILL stop the loop, and cannot
 * report what might — a failing test, a stuck agent, a merge conflict.
 */
export interface LoopCompletion {
  /** True when every remaining increment is reachable by running the loop. */
  willComplete: boolean;
  /** Remaining increments the loop can still finish. */
  reachable: string[];
  /** Remaining increments it cannot, root causes included. */
  unreachable: string[];
  /** The root causes — what a person actually has to resolve. */
  terminal: LoopTerminalBlocker[];
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
  completion: LoopCompletion;
  diagnostics: DiagnosticView[];
}

/**
 * The only blocking reason the loop clears by itself.
 *
 * Its actions are link, propose, continue, implement and verify. None of them
 * materialises a brief, lifts an `on_hold`, removes a manual blocker or
 * resolves an ambiguous archive — so every other reason waits for a person, no
 * matter how many iterations run.
 */
const TRANSIENT_REASONS = new Set(['dependency_pending']);

export interface CompletionInput {
  remaining: string[];
  /** Increment id -> why it is blocked, for every remaining increment that is. */
  blockedReasons: Map<string, { reasonCodes: string[]; manualBlockers: string[] }>;
  cancelledIds: Set<string>;
  /** True when something blocks the plan as a whole, not one increment. */
  planBlocked: boolean;
  dependsOnOf: (id: string) => string[];
  ancestorsOf: (id: string) => string[];
}

/**
 * Which remaining increments the loop can reach, and which it cannot.
 *
 * Pure, and separated from the snapshot so the classification can be tested
 * without building a workspace: it is the part where being wrong is expensive.
 * Erring toward "terminal" produces false alarms, and a preflight that cries
 * wolf gets ignored — the same failure mode as blocking too much.
 */
export function computeCompletion(input: CompletionInput): LoopCompletion {
  const terminal = new Map<string, { reasonCodes: string[]; manualBlockers: string[] }>();

  for (const id of input.remaining) {
    const blocked = input.blockedReasons.get(id);
    if (blocked && !blocked.reasonCodes.every((code) => TRANSIENT_REASONS.has(code))) {
      terminal.set(id, blocked);
      continue;
    }
    // A cancelled dependency never reaches `archived`, so an increment waiting
    // on one waits forever while reporting the ordinary `dependency_pending`.
    // Reading the reason alone would call this reachable.
    const dead = input.dependsOnOf(id).filter((dep) => input.cancelledIds.has(dep));
    if (dead.length > 0) {
      terminal.set(id, { reasonCodes: ['dependency_cancelled'], manualBlockers: [] });
    }
  }

  const unreachable = new Set(terminal.keys());
  for (const id of input.remaining) {
    if (unreachable.has(id)) continue;
    if (input.ancestorsOf(id).some((ancestor) => terminal.has(ancestor))) unreachable.add(id);
  }
  if (input.planBlocked) for (const id of input.remaining) unreachable.add(id);

  return {
    willComplete: unreachable.size === 0,
    reachable: input.remaining.filter((id) => !unreachable.has(id)),
    unreachable: input.remaining.filter((id) => unreachable.has(id)),
    terminal: [...terminal.entries()]
      .map(([id, cause]) => ({
        id,
        reasonCodes: cause.reasonCodes,
        manualBlockers: cause.manualBlockers,
        blocks: input.remaining.filter(
          (other) =>
            other !== id && unreachable.has(other) && input.ancestorsOf(other).includes(id)
        ),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
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

  // Why each remaining increment is held up, for the completion analysis. Fed
  // from two places: every `block()` call, and the `link` candidates below.
  const blockedReasons = new Map<string, { reasonCodes: string[]; manualBlockers: string[] }>();
  const block = (id: string | null, reasonCodes: string[], blockedBy: string[] = [], manualBlockers: string[] = []) => {
    blockers.push({ id, reasonCodes, blockedBy, manualBlockers });
    if (id !== null) blockedReasons.set(id, { reasonCodes, manualBlockers });
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
      // Linking is bookkeeping: it records that work on disk belongs to this
      // increment, and authorises nothing. An increment that is blocked for its
      // own reasons goes right back to blocked on the next iteration, so it must
      // not count as reachable just because there is an action for it now.
      if (view.readiness !== 'ready' && !archived) {
        blockedReasons.set(view.id, {
          reasonCodes: view.readinessReasons,
          manualBlockers: view.manualBlockers,
        });
      }
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
  const completion = computeCompletion({
    remaining,
    blockedReasons,
    cancelledIds: new Set(cancelled),
    planBlocked: blockers.some((entry) => entry.id === null),
    dependsOnOf: (id) => status.changes.find((view) => view.id === id)?.dependsOn ?? [],
    ancestorsOf: (id) => status.graph.ancestors(id),
  });

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
    completion,
    diagnostics: status.diagnostics,
  };
}
