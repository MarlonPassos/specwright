import path from 'node:path';
import { isDirectory, pathExists } from '../../util/fs.js';
import { readTaskProgress } from '../change/model.js';
import {
  ARCHIVE_DIR,
  CHANGES_DIR,
  WORKSPACE_DIR,
  listArchivedChanges,
  type Workspace,
} from '../workspace.js';
import type { ChangeLink } from './model.js';
import { archiveNamePattern, sortArchiveDirs } from './archive-identity.js';
import { safeResolve } from './paths.js';

export interface ChangeEvidence {
  linked: boolean;
  /** `spec/changes/<name>/` exists. */
  activeDirExists: boolean;
  proposalPresent: boolean;
  tasks?: { total: number; completed: number };
  /**
   * Resolved archive DIRECTORY, relative to the project root, POSIX. Set only
   * after an `isDirectory` check succeeded: no declared field can produce it
   * on its own (I-7).
   */
  archivePath?: string;
  /** More than one archive directory matched the slug. */
  ambiguousArchive: string[];
  /**
   * A persisted `archive_path` was present and was DISCARDED — it is not a
   * directory, or it names another slug. Surfaced so the correction is never
   * silent (F-04).
   */
  invalidArchivePath?: string;
  /** Declared link paths that escape or are unsafe to resolve. */
  unsafe?: Array<'active_path' | 'archive_path'>;
  /** Declared paths that are safe but point at a different identity. */
  mismatched?: Array<'active_path'>;
}

export type ArchiveResolutionReason =
  | 'explicit_path'
  | 'explicit_path_invalid'
  | 'newest_candidate'
  | 'none';

export interface ArchiveResolution {
  /** Directory chosen, relative to the project root, POSIX. */
  chosen?: string;
  /** Every candidate, newest first, relative to the project root, POSIX. */
  all: string[];
  /** How `chosen` was obtained. */
  reason: ArchiveResolutionReason;
  /** The persisted path that was refused, when `reason` says one was. */
  rejectedPath?: string;
}

const archiveRel = (name: string): string =>
  `${WORKSPACE_DIR}/${CHANGES_DIR}/${ARCHIVE_DIR}/${name}`;

/**
 * Reads everything the state layer needs about a linked native change, using
 * only existing read-only APIs. Isolated in one module so a test can replace it.
 */
export async function readEvidence(
  workspace: Workspace,
  link: ChangeLink | null
): Promise<ChangeEvidence> {
  if (!link) {
    return {
      linked: false,
      activeDirExists: false,
      proposalPresent: false,
      ambiguousArchive: [],
      unsafe: [],
      mismatched: [],
    };
  }

  // `link.name` comes from the manifest: resolve it fail-closed, so a symlink
  // that leaves the workspace reads as absent instead of leaking (I-8, NFR-08).
  const activeDir = safeResolve(workspace.changesPath, link.name);
  const activeDirExists = activeDir !== undefined && (await isDirectory(activeDir));
  const proposalPresent =
    activeDirExists && (await pathExists(path.join(activeDir!, 'proposal.md')));
  const progress = activeDirExists ? await readTaskProgress(activeDir!) : undefined;

  const matches = await resolveArchiveEvidence(workspace, {
    name: link.name,
    explicitPath: link.archive_path,
  });
  const unsafe: Array<'active_path' | 'archive_path'> = [];
  if (link.active_path !== null && safeResolve(workspace.projectRoot, link.active_path) === undefined) {
    unsafe.push('active_path');
  }
  if (link.archive_path !== null && safeResolve(workspace.projectRoot, link.archive_path) === undefined) {
    unsafe.push('archive_path');
  }
  const mismatched = linkPathMismatches(workspace, link, activeDirExists, matches.chosen);

  return {
    linked: true,
    activeDirExists,
    proposalPresent,
    ...(progress ? { tasks: { total: progress.total, completed: progress.completed } } : {}),
    ...(matches.chosen ? { archivePath: matches.chosen } : {}),
    ambiguousArchive: matches.all.length > 1 ? matches.all : [],
    ...(matches.reason === 'explicit_path_invalid' && matches.rejectedPath !== undefined
      ? { invalidArchivePath: matches.rejectedPath }
      : {}),
    unsafe,
    mismatched,
  };
}

/**
 * THE resolver for "which archive directory answers for this change".
 *
 * Everything that needs the answer — `readEvidence`, `link`, `sync --link`,
 * `status`'s repair hints — goes through here. There used to be three
 * independent implementations, two of them sorting candidates as plain text, so
 * `...-2` outranked `...-10` and the same slug resolved to different archives
 * depending on which command asked (F-01, A-01).
 *
 * A persisted `archive_path` is a shortcut, not a promise. It is honoured only
 * when it resolves inside the workspace, IS A DIRECTORY, and carries a name
 * that answers for `name`. `pathExists` used to be enough, so a regular file
 * dropped at that path produced `execution: archived` out of thin air — and,
 * worse, then blocked legitimate mutation as a "completed" increment
 * (F-04, A-03). When the shortcut does not hold, resolution falls back to the
 * candidate scan, which is fail-closed by construction.
 */
export async function resolveArchiveEvidence(
  workspace: Workspace,
  target: { name: string; explicitPath?: string | null }
): Promise<ArchiveResolution> {
  const pattern = archiveNamePattern(target.name);
  const all = sortArchiveDirs(
    (await listArchivedChanges(workspace)).filter((name) => pattern.test(name))
  ).map(archiveRel);

  const explicit = target.explicitPath;
  if (explicit) {
    const normalised = explicit.replace(/\\/g, '/');
    const abs = safeResolve(workspace.projectRoot, normalised);
    const archiveAbs = safeResolve(workspace.archivePath, path.basename(normalised));
    const valid =
      abs !== undefined &&
      archiveAbs !== undefined &&
      abs === archiveAbs &&
      pattern.test(path.basename(normalised)) &&
      (await isDirectory(abs));
    if (valid) {
      return { chosen: normalised, all: all.includes(normalised) ? all : [normalised, ...all], reason: 'explicit_path' };
    }
    return {
      ...(all.length > 0 ? { chosen: all[0] } : {}),
      all,
      reason: 'explicit_path_invalid',
      rejectedPath: normalised,
    };
  }

  if (all.length === 0) return { all: [], reason: 'none' };
  return { chosen: all[0], all, reason: 'newest_candidate' };
}

export interface LinkEvidenceVerdict {
  /** `spec/changes/<link.name>/` is a directory inside the workspace. */
  activeDirExists: boolean;
  archive: ArchiveResolution;
  /** Neither an active directory nor a resolvable archive: §7.17 ERROR 22. */
  dangling: boolean;
  /** Declared paths `safeResolve` refuses: absolute, `..`, NUL, symlink escape. */
  unsafe: Array<'active_path' | 'archive_path'>;
  /** Safe paths whose target does not match the identity in `link.name`. */
  mismatched: Array<'active_path'>;
}

/**
 * THE verdict on "is this link backed by anything real".
 *
 * `validate` used to answer this by looking at the SHAPE of the two path
 * strings — prefix, `..`, NUL — while `status` answered it with `safeResolve`
 * plus `isDirectory`. Two authorities, and the weaker one was the CI gate: a
 * plan whose link pointed at nothing, or escaped the workspace through a
 * symlink, passed `validate --strict` while `status` called it `dangling_link`
 * (F-03). Both now read the same verdict, so they cannot disagree.
 */
export async function validateLinkEvidence(
  workspace: Workspace,
  link: ChangeLink
): Promise<LinkEvidenceVerdict> {
  const activeDir = safeResolve(workspace.changesPath, link.name);
  const activeDirExists = activeDir !== undefined && (await isDirectory(activeDir));
  const archive = await resolveArchiveEvidence(workspace, {
    name: link.name,
    explicitPath: link.archive_path,
  });

  const unsafe: Array<'active_path' | 'archive_path'> = [];
  if (link.active_path !== null && safeResolve(workspace.projectRoot, link.active_path) === undefined) {
    unsafe.push('active_path');
  }
  if (link.archive_path !== null && safeResolve(workspace.projectRoot, link.archive_path) === undefined) {
    unsafe.push('archive_path');
  }
  const mismatched = linkPathMismatches(workspace, link, activeDirExists, archive.chosen);

  return {
    activeDirExists,
    archive,
    dangling: !activeDirExists && archive.chosen === undefined,
    unsafe,
    mismatched,
  };
}

function linkPathMismatches(
  workspace: Workspace,
  link: ChangeLink,
  activeDirExists: boolean,
  archivePath: string | undefined
): Array<'active_path'> {
  const expectedActive = safeResolve(workspace.changesPath, link.name);
  if (expectedActive === undefined) return [];

  if (link.active_path === null) {
    // `null` is correct for an archive link. When no archive is available, an
    // existing active directory still needs the canonical active_path recorded;
    // otherwise status and sync disagree about the same link.
    return activeDirExists && archivePath === undefined ? ['active_path'] : [];
  }

  const declaredActive = safeResolve(workspace.projectRoot, link.active_path);
  return declaredActive !== undefined && declaredActive !== expectedActive ? ['active_path'] : [];
}
