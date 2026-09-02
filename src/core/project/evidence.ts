import path from 'node:path';
import { pathExists } from '../../util/fs.js';
import { readTaskProgress } from '../change/model.js';
import {
  ARCHIVE_DIR,
  CHANGES_DIR,
  WORKSPACE_DIR,
  listArchivedChanges,
  type Workspace,
} from '../workspace.js';
import type { ChangeLink } from './model.js';

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

  const activeDir = path.join(workspace.changesPath, link.name);
  const activeDirExists = await pathExists(activeDir);
  const proposalPresent = activeDirExists && (await pathExists(path.join(activeDir, 'proposal.md')));
  const progress = activeDirExists ? await readTaskProgress(activeDir) : undefined;

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
    const abs = path.join(workspace.projectRoot, link.archive_path);
    if (await pathExists(abs)) {
      return { chosen: link.archive_path.replace(/\\/g, '/'), all: [link.archive_path.replace(/\\/g, '/')] };
    }
  }

  const pattern = ARCHIVE_NAME(link.name);
  const all = (await listArchivedChanges(workspace)).filter((name) => pattern.test(name));
  if (all.length === 0) return { all: [] };
  // Latest by name: the date prefix sorts chronologically, the -N suffix breaks ties.
  const chosen = [...all].sort((a, b) => b.localeCompare(a))[0];
  return { chosen: rel(chosen), all: all.map(rel) };
}
