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
import { safeResolve } from './paths.js';

export interface ChangeEvidence {
  linked: boolean;
  /** `spec/changes/<name>/` exists. */
  activeDirExists: boolean;
  proposalPresent: boolean;
  tasks?: { total: number; completed: number };
  /** Resolved archive directory, relative to the project root, POSIX. */
  archivePath?: string;
  /** More than one archive directory matched the slug. */
  ambiguousArchive: string[];
}

const ARCHIVE_NAME = (slug: string) =>
  new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escapeRegExp(slug)}(-\\d+)?$`);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads everything the state layer needs about a linked native change, using
 * only existing read-only APIs. Isolated in one module so a test can replace it.
 */
export async function readEvidence(
  workspace: Workspace,
  link: ChangeLink | null
): Promise<ChangeEvidence> {
  if (!link) {
    return { linked: false, activeDirExists: false, proposalPresent: false, ambiguousArchive: [] };
  }

  // `link.name` comes from the manifest: resolve it fail-closed, so a symlink
  // that leaves the workspace reads as absent instead of leaking (I-8, NFR-08).
  const activeDir = safeResolve(workspace.changesPath, link.name);
  const activeDirExists = activeDir !== undefined && (await isDirectory(activeDir));
  const proposalPresent =
    activeDirExists && (await pathExists(path.join(activeDir!, 'proposal.md')));
  const progress = activeDirExists ? await readTaskProgress(activeDir!) : undefined;

  const matches = await resolveArchive(workspace, link);

  return {
    linked: true,
    activeDirExists,
    proposalPresent,
    ...(progress ? { tasks: { total: progress.total, completed: progress.completed } } : {}),
    ...(matches.chosen ? { archivePath: matches.chosen } : {}),
    ambiguousArchive: matches.all.length > 1 ? matches.all : [],
  };
}

async function resolveArchive(
  workspace: Workspace,
  link: ChangeLink
): Promise<{ chosen?: string; all: string[] }> {
  const rel = (name: string) => `${WORKSPACE_DIR}/${CHANGES_DIR}/${ARCHIVE_DIR}/${name}`;

  // An explicit, still-present archive_path wins.
  if (link.archive_path) {
    const abs = safeResolve(workspace.projectRoot, link.archive_path);
    if (abs !== undefined && (await pathExists(abs))) {
      return { chosen: link.archive_path.replace(/\\/g, '/'), all: [link.archive_path.replace(/\\/g, '/')] };
    }
  }

  const pattern = ARCHIVE_NAME(link.name);
  const all = (await listArchivedChanges(workspace)).filter((name) => pattern.test(name));
  if (all.length === 0) return { all: [] };
  const chosen = [...all].sort(byDateThenSuffix)[0];
  return { chosen: rel(chosen), all: all.map(rel) };
}

/**
 * Newest first: the date prefix compares as text (it is zero-padded), the `-N`
 * collision suffix compares as a NUMBER. A plain string sort would rank
 * `...-2` above `...-10`, picking the wrong archive.
 */
function byDateThenSuffix(a: string, b: string): number {
  const split = (name: string): [string, number] => {
    const match = /^(\d{4}-\d{2}-\d{2}-.*?)(?:-(\d+))?$/.exec(name)!;
    return [match[1], match[2] === undefined ? 1 : Number(match[2])];
  };
  const [dateA, suffixA] = split(a);
  const [dateB, suffixB] = split(b);
  return dateB.localeCompare(dateA) || suffixB - suffixA || b.localeCompare(a);
}
