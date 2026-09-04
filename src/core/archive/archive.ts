import path from 'node:path';
import { promises as fs } from 'node:fs';
import { SpecError } from '../../util/errors.js';
import { ensureDir, isDirectory, pathExists, withStaging } from '../../util/fs.js';
import { localDateStamp } from '../../util/date.js';
import { readChangeMetadata } from '../change/metadata.js';
import { readDeltaSpecs, readTaskProgress } from '../change/model.js';
import { specPath } from '../specs.js';
import { validateChange } from '../validate/change-validator.js';
import { changeDir, type Workspace } from '../workspace.js';
import { adviseLink, soleCandidate } from '../project/advice.js';
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

export interface ArchivePlanAmbiguity {
  /** Every increment that could have claimed this change. */
  candidates: Array<{ plan: string; change: string; fix: string }>;
  /** A command the user can run to resolve it. */
  fix: string;
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
  /**
   * Present when more than one increment could have claimed this change and
   * NOTHING was written. The archive itself is unaffected (I-4).
   */
  planAmbiguity?: ArchivePlanAmbiguity;
}

export async function archiveChange(
  workspace: Workspace,
  changeId: string,
  options: ArchiveOptions = {}
): Promise<ArchiveResult> {
  const dir = changeDir(workspace, changeId);
  // A change is a DIRECTORY: a regular file with the right name is not one.
  if (!(await isDirectory(dir))) {
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

  // Every merge is computed before anything is written, AND every write commits
  // together. Computing up front only guaranteed that a delta which cannot be
  // merged stops the archive; the writes themselves went to disk one by one, so
  // a failure on the N-th spec left the earlier ones applied, the change still
  // active and nothing archived — a partial state NFR-07 forbids (F-08).
  //
  // Order of commit, declared: specs first, the change directory last. An
  // interruption then leaves specs applied with the change still active, which
  // `specs validate` reports and a re-run repairs, instead of an archive that
  // claims work whose specs never landed.
  if (writes.length > 0 || removals.length > 0) {
    await ensureDir(workspace.specsPath);
    const relativeToSpecs = (target: string): string =>
      path.relative(workspace.specsPath, target);
    await withStaging(workspace.specsPath, async (stage, remove) => {
      for (const write of writes) stage(relativeToSpecs(write.filePath), write.content);
      for (const target of removals) remove(relativeToSpecs(target));
    });
    // Only once the transaction committed: pruning an empty directory is not
    // part of the all-or-nothing set and must never run before it.
    for (const target of removals) {
      await pruneEmptyDirs(path.dirname(target), workspace.specsPath);
    }
  }

  await ensureDir(workspace.archivePath);
  const archivedAs = await claimArchiveName(workspace, changeId, options.now ?? new Date());
  const destination = path.join(workspace.archivePath, archivedAs);
  await moveIntoClaimedDir(dir, destination);

  const closure = await linkArchivedToPlan(workspace, changeId);

  return {
    change: changeId,
    archivedAs,
    archivePath: destination,
    createdSpecs: created.sort(),
    updatedSpecs: updated.sort(),
    retiredSpecs: retired.sort(),
    specsSkipped,
    ...(closure.plan ? { plan: closure.plan } : {}),
    ...(closure.ambiguity ? { planAmbiguity: closure.ambiguity } : {}),
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
 * EXACTLY ONE candidate closes the link. With several, nothing is written and
 * the ambiguity is reported instead: §7.10's exception is there to close a link
 * the plan already foresaw, not to choose which plan owns the work, and picking
 * by directory order picked by accident (F-02). The work stays visible either
 * way — the next `status` reports it as `unclaimed_archive` with a runnable fix.
 *
 * Best effort, and deliberately so. No plan, several plans with none matching,
 * an unreadable manifest, a plan that refuses the write — every one of those
 * leaves the archive exactly as it would have been. Archiving must never fail,
 * and never behave differently, because of the state of a plan; the plan is
 * downstream of the work, not a gate on it (I-4).
 */
async function linkArchivedToPlan(
  workspace: Workspace,
  changeId: string
): Promise<{ plan?: ArchivedPlanLink; ambiguity?: ArchivePlanAmbiguity }> {
  try {
    const advice = await adviseLink(workspace.projectRoot, changeId);
    if (advice.ambiguous) {
      return {
        ambiguity: {
          candidates: advice.candidates.map((candidate) => ({
            plan: candidate.plan,
            change: candidate.change,
            fix: candidate.fix,
          })),
          fix: advice.candidates[0].fix,
        },
      };
    }

    const only = soleCandidate(advice);
    if (!only) return {};

    const result = await linkChange(workspace, only.plan, only.change, changeId);
    return {
      plan: {
        plan: only.plan,
        change: result.id,
        archivePath: result.archivePath ?? null,
        revision: result.revision,
      },
    };
  } catch {
    return {};
  }
}

/**
 * `<date>-<change>`, with a numeric suffix when that name is taken. Archiving
 * the same change name twice on one day is rare but must not overwrite history.
 *
 * The name is claimed by CREATING the directory, which is the atomic
 * test-and-set the filesystem gives us. Checking `pathExists` first left a
 * window in which another archive could take the same name between the check
 * and the move, and a rename onto an empty directory silently succeeds on POSIX
 * — so the loser overwrote the winner's slot (A-06).
 */
async function claimArchiveName(
  workspace: Workspace,
  changeId: string,
  now: Date
): Promise<string> {
  const base = `${localDateStamp(now)}-${changeId}`;
  let candidate = base;
  let suffix = 2;

  for (;;) {
    try {
      await fs.mkdir(path.join(workspace.archivePath, candidate));
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
  }
}

/**
 * Moves the change onto the name `claimArchiveName` reserved. The reservation is
 * an empty directory: POSIX `rename` replaces it, Windows refuses, so the
 * placeholder is dropped and the move retried once. A failure here leaves the
 * placeholder behind rather than a half-moved change.
 */
async function moveIntoClaimedDir(from: string, destination: string): Promise<void> {
  try {
    await fs.rename(from, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'EPERM' || code === 'EACCES') {
      await fs.rmdir(destination).catch(() => undefined);
      await fs.rename(from, destination);
      return;
    }
    await fs.rmdir(destination).catch(() => undefined);
    throw error;
  }
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
