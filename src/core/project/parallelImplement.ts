import { readDeltaSpecs } from '../change/model.js';
import { changeDir, changeExists, type Workspace } from '../workspace.js';
import { PRIORITY_RANK } from './state.js';
import type { PlanStatus } from './status.js';
import type { Priority } from './model.js';

export interface ParallelImplementCandidate {
  id: string;
  link: string;
  capabilities: string[];
}

export interface ParallelImplementExclusion {
  id: string;
  reason: string;
}

export interface ParallelImplementBatch {
  batch: ParallelImplementCandidate[];
  excluded: ParallelImplementExclusion[];
}

/**
 * The subset of `status.changes` safe to hand a worktree-isolated `/spec-implement`
 * dispatch RIGHT NOW: already proposed (not merely plan-ready — a bare Planned
 * Change has no proposal/design/tasks/deltas yet, so there is nothing for
 * `/spec-implement` to read), not already being worked, and pairwise
 * disjoint on which capability each touches.
 *
 * Capability disjointness is the one thing `parallelReady` (`next.ts`) does
 * NOT check — it only proves the absence of a declared PLAN dependency, which
 * `next.ts`'s own caveat already says nothing about code conflict. Here that
 * gap is closed the only way it structurally can be before implementation: by
 * reading the delta specs each candidate ALREADY wrote during propose. Two
 * candidates naming the same capability are exactly the case `/spec-project-refine`
 * would flag as a real design collision if it saw them side by side - dispatching
 * both into worktrees regardless would race two full implementations onto the
 * same behavior contract, then discover it at merge time instead of before.
 *
 * A change with no capability at all (created with `--skip-specs`) never
 * conflicts with anything by this measure and is always includable.
 */
export async function computeParallelImplementBatch(
  workspace: Workspace,
  status: PlanStatus
): Promise<ParallelImplementBatch> {
  const excluded: ParallelImplementExclusion[] = [];
  const candidates: ParallelImplementCandidate[] = [];

  for (const view of status.changes) {
    if (view.readiness !== 'ready') {
      excluded.push({ id: view.id, reason: `readiness_${view.readiness}` });
      continue;
    }
    if (!view.link) {
      excluded.push({ id: view.id, reason: 'not_linked' });
      continue;
    }
    if (view.execution !== 'proposed') {
      excluded.push({ id: view.id, reason: `execution_${view.execution}` });
      continue;
    }

    if (!(await changeExists(workspace, view.link.name))) {
      excluded.push({ id: view.id, reason: 'change_dir_missing' });
      continue;
    }
    const deltas = await readDeltaSpecs(changeDir(workspace, view.link.name));
    const capabilities = [...new Set(deltas.map((delta) => delta.capability))];

    candidates.push({ id: view.id, link: view.link.name, capabilities });
  }

  // Priority first, same rank `next.ts` uses, so a tie in the greedy pass
  // below is decided by the plan's own stated priority rather than by
  // declaration order alone.
  const priorityOf = new Map(status.changes.map((view) => [view.id, view.priority as Priority]));
  candidates.sort((a, b) => (PRIORITY_RANK[priorityOf.get(b.id)!] ?? 0) - (PRIORITY_RANK[priorityOf.get(a.id)!] ?? 0));

  const batch: ParallelImplementCandidate[] = [];
  const claimedCapabilities = new Set<string>();
  for (const candidate of candidates) {
    const conflict = candidate.capabilities.find((capability) => claimedCapabilities.has(capability));
    if (conflict) {
      excluded.push({ id: candidate.id, reason: `capability_conflict:${conflict}` });
      continue;
    }
    batch.push(candidate);
    for (const capability of candidate.capabilities) claimedCapabilities.add(capability);
  }

  return { batch, excluded };
}
