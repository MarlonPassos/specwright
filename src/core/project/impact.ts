import path from 'node:path';
import { SpecError } from '../../util/errors.js';
import { pathExists } from '../../util/fs.js';
import { readDeltaSpecs } from '../change/model.js';
import { type Workspace } from '../workspace.js';
import { computeProjectStatus } from './status.js';
import { safeResolve } from './paths.js';

export interface ImpactResult {
  targets: string[];
  dependents: string[];
  ancestors: string[];
  milestones: string[];
  linkedChanges: Array<{ id: string; name: string; execution: string; path: string | null }>;
  /**
   * One entry per linked change in the affected set. A change whose directory
   * cannot be resolved appears as `{ capability: null, reason: 'change_dir_missing' }`
   * — never omitted in silence (§7.12).
   */
  sharedCapabilities: Array<{ capability: string | null; change?: string; reason?: string }>;
  affectedPlannedChanges: string[];
  completedReached: string[];
}

/**
 * The deterministic structural impact of touching one or more increments
 * (§7.12). Semantic impact is the agent's job in `project-refine`.
 */
export async function computeImpact(
  workspace: Workspace,
  planId: string,
  targets: string[]
): Promise<ImpactResult> {
  const status = await computeProjectStatus(workspace, planId);
  const known = new Set(status.changes.map((change) => change.id));
  for (const target of targets) {
    if (!known.has(target)) {
      throw new SpecError(`O incremento ${target} não existe no plano.`, {
        code: 'change_not_found',
        fix: 'specs project status --json',
      });
    }
  }

  const dependents = new Set<string>();
  const ancestors = new Set<string>();
  for (const target of targets) {
    status.graph.descendants(target).forEach((id) => dependents.add(id));
    status.graph.ancestors(target).forEach((id) => ancestors.add(id));
  }

  const affected = new Set<string>([...targets, ...dependents]);

  const milestones = new Set<string>();
  for (const change of status.changes) {
    if (affected.has(change.id) && change.milestone) milestones.add(change.milestone);
  }

  const linkedChanges: ImpactResult['linkedChanges'] = [];
  const capabilities = new Map<string, { capability: string | null; change?: string; reason?: string }>();
  for (const change of status.changes) {
    if (!affected.has(change.id) || !change.link) continue;
    const dir = resolveChangeDir(workspace, change.link);
    linkedChanges.push({
      id: change.id,
      name: change.link.name,
      execution: change.execution,
      path: dir ? path.relative(workspace.projectRoot, dir).replace(/\\/g, '/') : null,
    });
    if (dir && (await pathExists(dir))) {
      for (const delta of await readDeltaSpecs(dir)) {
        capabilities.set(delta.capability, { capability: delta.capability });
      }
    } else {
      // The directory is gone: say so instead of dropping the change silently.
      capabilities.set(`missing:${change.id}`, {
        capability: null,
        change: change.id,
        reason: 'change_dir_missing',
      });
    }
  }

  const affectedPlannedChanges = status.changes
    .filter(
      (change) =>
        affected.has(change.id) &&
        change.plannedChange !== null &&
        change.plannedChange.state !== 'missing'
    )
    .map((change) => change.plannedChange!.path);

  const completedReached = status.changes
    .filter((change) => affected.has(change.id) && change.execution === 'archived')
    .map((change) => change.id);

  return {
    targets: [...targets],
    dependents: [...dependents],
    ancestors: [...ancestors],
    milestones: [...milestones],
    linkedChanges,
    sharedCapabilities: [...capabilities.values()],
    affectedPlannedChanges,
    completedReached,
  };
}

function resolveChangeDir(
  workspace: Workspace,
  link: { name: string; activePath: string | null; archivePath: string | null }
): string | undefined {
  if (link.archivePath) return safeResolve(workspace.projectRoot, link.archivePath);
  if (link.activePath) return safeResolve(workspace.projectRoot, link.activePath);
  return safeResolve(workspace.changesPath, link.name);
}
