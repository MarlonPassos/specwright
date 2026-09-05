import { computeStatus, resolveChangeContext } from '../change/status.js';
import { isMainWorktree } from '../change/worktree.js';
import { detectHarness } from '../harness/current.js';
import type { WorkspaceConfig } from '../config.js';
import type { Workspace } from '../workspace.js';
import { PRIORITY_RANK } from './state.js';
import type { PlanStatus } from './status.js';
import type { Priority } from './model.js';

export interface ProposeBatchCandidate {
  id: string;
  /** Slug the change directory will be created under (`specs new change <slug>`). */
  slug: string;
  title: string;
  /** Plan-relative path of the Planned Change brief to explore FROM, never to copy. */
  plannedChange: string | null;
}

export interface ProposeBatchExclusion {
  id: string;
  reason: string;
}

export interface ProposeBatchResult {
  /**
   * Whether a batch may be OFFERED at all: the workspace opted in
   * (`parallelPropose`), the harness can dispatch subagents, and this is the
   * main worktree. `batch` is still computed either way - a disabled workspace
   * can see what it would get without acting on it.
   */
  enabled: boolean;
  batch: ProposeBatchCandidate[];
  excluded: ProposeBatchExclusion[];
}

/**
 * Planned Changes that could be handed to `/spec-explore` + `/spec-propose`
 * RIGHT NOW, in parallel, without any of them waiting on another.
 *
 * The safety signal here is NOT the one `computeParallelImplementBatch` uses.
 * That one reads each candidate's delta specs to prove no two touch the same
 * capability - impossible at propose time, because writing those deltas IS
 * what propose does. Before propose, the only structural fact available is the
 * plan's own dependency graph, so that is what gates the batch: a change whose
 * `depends_on` is not settled never enters it.
 *
 * "Settled" here is deliberately WEAKER than `readinessOf`'s rule, which
 * requires a dependency to be `archived`. Propose is a design activity: it
 * needs the dependency's decisions to exist, not its code. Requiring `archived`
 * would mean nothing could ever be proposed further ahead than it could be
 * implemented - which is exactly the backlog this feature exists to build. So a
 * dependency counts as settled once it is archived OR fully proposed (its own
 * `applyBlockedBy` is empty: proposal, design, specs and tasks all written).
 * That is the same state a finished propose-wave leaves behind, so wave N
 * mechanically unblocks wave N+1.
 *
 * A batch can never contain a change together with its own dependency: for
 * both to qualify, the dependency would have to be simultaneously `unlinked`
 * (to be a candidate) and fully proposed (to satisfy its dependent) - so no
 * intra-batch ordering pass is needed on top of this filter.
 *
 * Every candidate must also be creatable: the batch opens each change with
 * `specs new change <slug>`, so a slug some directory already answers to is
 * excluded rather than dispatched into a command that would fail or, worse,
 * quietly create a directory an archive of the same name masks.
 */
export async function computeProposeBatch(
  workspace: Workspace,
  status: PlanStatus,
  config: WorkspaceConfig
): Promise<ProposeBatchResult> {
  const harness = detectHarness({ configured: config.harnesses });
  // No git repository at all is not an isolated worktree - same reasoning as
  // `resolveParallelDispatch` in instructions.ts.
  const onMainWorktree = await isMainWorktree(workspace.projectRoot).catch(() => true);
  const enabled =
    config.parallelPropose === true && harness.supportsParallelDispatch === true && onMainWorktree;

  const invalidBrief = new Set(
    status.diagnostics
      .filter((diagnostic) => diagnostic.code === 'planned_change_invalid')
      .map((diagnostic) => diagnostic.path.split('.')[1])
  );

  const settled = new Map<string, boolean>();
  const isSettled = async (id: string): Promise<boolean> => {
    const cached = settled.get(id);
    if (cached !== undefined) return cached;

    const view = status.changes.find((entry) => entry.id === id);
    let value = false;
    if (view?.execution === 'archived') {
      value = true;
    } else if (view?.link) {
      try {
        const native = await computeStatus(await resolveChangeContext(workspace, view.link.name));
        value = native.ready;
      } catch {
        value = false;
      }
    }
    settled.set(id, value);
    return value;
  };

  const excluded: ProposeBatchExclusion[] = [];
  const candidates: ProposeBatchCandidate[] = [];

  for (const view of status.changes) {
    if (view.planningState !== 'planned') {
      excluded.push({ id: view.id, reason: `state_${view.planningState}` });
      continue;
    }
    // Anything already linked has a change directory - propose either happened
    // or is midway. Finishing a half-written change by hand is a different job
    // from dispatching a fresh one, and batching it would race whoever is in it.
    if (view.execution !== 'unlinked') {
      excluded.push({ id: view.id, reason: `execution_${view.execution}` });
      continue;
    }
    if (!view.plannedChange) {
      excluded.push({ id: view.id, reason: 'planned_change_missing' });
      continue;
    }
    if (view.plannedChange.state !== 'current') {
      excluded.push({ id: view.id, reason: `planned_change_${view.plannedChange.state}` });
      continue;
    }
    // A bare §7.5 skeleton has no Escopo and no Critérios macro: there is
    // nothing for exploration to work FROM, which is the whole input propose
    // needs. Fill the brief first (`replacePlannedChange`), then batch it.
    if (invalidBrief.has(view.id)) {
      excluded.push({ id: view.id, reason: 'planned_change_invalid' });
      continue;
    }
    if (view.manualBlockers.length > 0) {
      excluded.push({ id: view.id, reason: 'manual_blocker_present' });
      continue;
    }
    // The batch's first move is `specs new change <slug>`, so a slug that
    // already answers to a directory cannot be in it: creating it again fails
    // outright (`change_exists`) when the change is active, and when only an
    // ARCHIVE carries the name it succeeds into a directory the archive then
    // masks (§7.7 resolves the archive first) - the empty-change trap
    // `startCommands` in next.ts already steers around. Which way out differs
    // per case, and picking a fresh slug is not a call to make unattended, so
    // both leave the batch with the reason that says what to do.
    const claimedByOther = status.changes.find(
      (other) => other.id !== view.id && other.link?.name === view.slug
    );
    if (claimedByOther) {
      excluded.push({ id: view.id, reason: `slug_claimed_by:${claimedByOther.id}` });
      continue;
    }
    if (
      status.workspaceChanges.active.has(view.slug) ||
      status.workspaceChanges.archivedSlugs.has(view.slug)
    ) {
      excluded.push({ id: view.id, reason: 'change_already_exists' });
      continue;
    }

    const pending: string[] = [];
    for (const dependency of view.dependsOn) {
      if (!(await isSettled(dependency))) pending.push(dependency);
    }
    if (pending.length > 0) {
      excluded.push({ id: view.id, reason: `depends_on_not_proposed:${pending.join(',')}` });
      continue;
    }

    candidates.push({
      id: view.id,
      slug: view.slug,
      title: view.title,
      plannedChange: view.plannedChange.path,
    });
  }

  const priorityOf = new Map(status.changes.map((view) => [view.id, view.priority as Priority]));
  candidates.sort(
    (a, b) => (PRIORITY_RANK[priorityOf.get(b.id)!] ?? 0) - (PRIORITY_RANK[priorityOf.get(a.id)!] ?? 0)
  );

  return { enabled, batch: candidates, excluded };
}
