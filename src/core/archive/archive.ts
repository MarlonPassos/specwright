import path from 'node:path';
import { promises as fs } from 'node:fs';
import { SpecError } from '../../util/errors.js';
import { ensureDir, pathExists, writeFileEnsured } from '../../util/fs.js';
import { localDateStamp } from '../../util/date.js';
import { readChangeMetadata } from '../change/metadata.js';
import { readDeltaSpecs, readTaskProgress } from '../change/model.js';
import { specPath } from '../specs.js';
import { validateChange } from '../validate/change-validator.js';
import { changeDir, type Workspace } from '../workspace.js';
import { adviseLink } from '../project/advice.js';
import { linkChange } from '../project/link.js';
import { mergeCapability } from './merge.js';

export interface ArchiveOptions {
  /** Skip the spec merge entirely. For changes that carry no spec deltas. */
  skipSpecs?: boolean;
  /** Skip validation before archiving. */
  validate?: boolean;
  /** Proceed even with unchecked tasks. */
  force?: boolean;
  now?: Date;
}

export interface ArchivedPlanLink {
  /** Plan that carried the increment. */
  plan: string;
  /** Increment now linked, e.g. `CH-018`. */
  change: string;
  /** Archive directory the link resolved to, project-relative. */
  archivePath: string | null;
  /** Plan revision after the link. */
  revision: number;
}

export interface ArchiveResult {
  change: string;
  archivedAs: string;
  archivePath: string;
  createdSpecs: string[];
  updatedSpecs: string[];
  retiredSpecs: string[];
  specsSkipped: boolean;
  /** Present only when archiving recorded a plan link. */
  plan?: ArchivedPlanLink;
}

export async function archiveChange(
  workspace: Workspace,
  changeId: string,
  options: ArchiveOptions = {}
): Promise<ArchiveResult> {
  const dir = changeDir(workspace, changeId);
  if (!(await pathExists(dir))) {
    throw new SpecError(`A change "${changeId}" não existe`, {
      code: 'change_not_found',
      fix: 'specs list',
    });
  }

  if (options.validate !== false) {
    const report = await validateChange(workspace, changeId);
    if (!report.valid) {
      const errors = report.issues
        .filter((issue) => issue.level === 'ERROR')
        .map((issue) => `  - ${issue.path}: ${issue.message}`)
        .join('\n');
      throw new SpecError(`A change "${changeId}" não está válida, então não foi arquivada:\n${errors}`, {
        code: 'change_invalid',
        fix: `specs validate ${changeId}`,
      });
    }
  }

  const tasks = await readTaskProgress(dir);
  if (tasks && tasks.completed < tasks.total && options.force !== true) {
    throw new SpecError(
      `A change "${changeId}" ainda tem ${tasks.total - tasks.completed} tarefa(s) não marcada(s)`,
      { code: 'tasks_incomplete', fix: `specs archive ${changeId} --force` }
    );
  }

  const metadata = await readChangeMetadata(dir);
  const specsSkipped = options.skipSpecs === true || metadata.skipSpecs;

  const created: string[] = [];
  const updated: string[] = [];
  const retired: string[] = [];
  const writes: Array<{ filePath: string; content: string }> = [];
  const removals: string[] = [];

  if (!specsSkipped) {
    for (const delta of await readDeltaSpecs(dir)) {
      if (delta.entries.length === 0) continue;

      const target = specPath(workspace, delta.capability);
      const existing = (await pathExists(target)) ? await fs.readFile(target, 'utf8') : undefined;

      const merged = mergeCapability(delta.capability, delta.entries, {
        existing,
        purpose: delta.purpose,
        changeId,
      });

      if (merged.empty) {
        // Every requirement was removed: the capability no longer exists, so
        // its spec file goes rather than being left as an empty shell.
        if (existing) removals.push(target);
        retired.push(delta.capability);
        continue;
      }

      writes.push({ filePath: target, content: merged.content });
      (existing ? updated : created).push(delta.capability);
    }
  }

  // Every merge is computed before anything is written, so a delta that cannot
  // be applied stops the archive with the workspace untouched.
  for (const write of writes) {
    await writeFileEnsured(write.filePath, write.content);
  }
  for (const target of removals) {
    await fs.rm(target, { force: true });
    await pruneEmptyDirs(path.dirname(target), workspace.specsPath);
  }

  const archivedAs = await claimArchiveName(workspace, changeId, options.now ?? new Date());
  const destination = path.join(workspace.archivePath, archivedAs);
  await ensureDir(workspace.archivePath);
  await fs.rename(dir, destination);

  const plan = await linkArchivedToPlan(workspace, changeId);

  return {
    change: changeId,
    archivedAs,
    archivePath: destination,
    createdSpecs: created.sort(),
    updatedSpecs: updated.sort(),
    retiredSpecs: retired.sort(),
    specsSkipped,
    ...(plan ? { plan } : {}),
  };
}

/**
 * Records the plan link for work a plan already planned, once the change sits
 * in the archive.
 *
 * Only an exact identity match claims anything: an increment whose `slug` EQUALS
 * the change name, with no link yet and not cancelled. Nothing is inferred from
 * title, date or similarity, which is the same bar `link` and `sync --link` use.
 *
 * Best effort, and deliberately so. No plan, several plans with none matching,
 * an unreadable manifest, a plan that refuses the write — every one of those
 * leaves the archive exactly as it would have been. Archiving must never fail,
 * and never behave differently, because of the state of a plan; the plan is
 * downstream of the work, not a gate on it.
 */
async function linkArchivedToPlan(
  workspace: Workspace,
  changeId: string
): Promise<ArchivedPlanLink | undefined> {
  try {
    const advice = await adviseLink(workspace.projectRoot, changeId);
    if (!advice) return undefined;

    const result = await linkChange(workspace, advice.plan, advice.change, changeId);
    return {
      plan: advice.plan,
      change: result.id,
      archivePath: result.archivePath ?? null,
      revision: result.revision,
    };
  } catch {
    return undefined;
  }
}

/**
 * `<date>-<change>`, with a numeric suffix when that name is taken. Archiving
 * the same change name twice on one day is rare but must not overwrite history.
 */
async function claimArchiveName(
  workspace: Workspace,
  changeId: string,
  now: Date
): Promise<string> {
  const base = `${localDateStamp(now)}-${changeId}`;
  let candidate = base;
  let suffix = 2;

  while (await pathExists(path.join(workspace.archivePath, candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function pruneEmptyDirs(start: string, boundary: string): Promise<void> {
  let current = path.resolve(start);
  const stop = path.resolve(boundary);

  while (current.startsWith(stop) && current !== stop) {
    const entries = await fs.readdir(current).catch(() => undefined);
    if (!entries || entries.length > 0) return;
    await fs.rmdir(current).catch(() => undefined);
    current = path.dirname(current);
  }
}
