import path from 'node:path';
import { promises as fs } from 'node:fs';
import { SpecError } from '../util/errors.js';
import { isDirectory, pathExists } from '../util/fs.js';

/** Directory that holds every artifact this tool manages. */
export const WORKSPACE_DIR = 'spec';
/** Marker whose presence identifies a directory as a workspace. */
export const CONFIG_FILE = 'config.yaml';
export const PROJECT_FILE = 'project.md';
export const SPECS_DIR = 'specs';
export const CHANGES_DIR = 'changes';
export const ARCHIVE_DIR = 'archive';
export const CHANGE_METADATA_FILE = '.change.yaml';

export interface Workspace {
  /** Project root: the directory that contains the workspace directory. */
  projectRoot: string;
  /** Absolute path of the workspace directory itself. */
  root: string;
  configPath: string;
  specsPath: string;
  changesPath: string;
  archivePath: string;
}

export function workspaceAt(projectRoot: string): Workspace {
  const root = path.join(projectRoot, WORKSPACE_DIR);
  return {
    projectRoot,
    root,
    configPath: path.join(root, CONFIG_FILE),
    specsPath: path.join(root, SPECS_DIR),
    changesPath: path.join(root, CHANGES_DIR),
    archivePath: path.join(root, CHANGES_DIR, ARCHIVE_DIR),
  };
}

async function isWorkspaceRoot(projectRoot: string): Promise<boolean> {
  return pathExists(path.join(projectRoot, WORKSPACE_DIR, CONFIG_FILE));
}

/**
 * Walks up from `startDir` looking for a directory that holds a workspace.
 * Returns undefined rather than throwing so callers can decide whether a
 * missing workspace is an error (most commands) or the expected state (`init`).
 */
export async function findWorkspace(startDir: string = process.cwd()): Promise<Workspace | undefined> {
  let current = path.resolve(startDir);

  for (;;) {
    if (await isWorkspaceRoot(current)) {
      return workspaceAt(current);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export async function requireWorkspace(startDir: string = process.cwd()): Promise<Workspace> {
  const workspace = await findWorkspace(startDir);
  if (!workspace) {
    throw new SpecError(
      `Nenhum workspace encontrado. Procurei por ${WORKSPACE_DIR}/${CONFIG_FILE} neste diretório e nos pais.`,
      { code: 'workspace_not_found', fix: 'specs init' }
    );
  }
  return workspace;
}

export function changeDir(workspace: Workspace, changeId: string): string {
  return path.join(workspace.changesPath, changeId);
}

export async function changeExists(workspace: Workspace, changeId: string): Promise<boolean> {
  return isDirectory(changeDir(workspace, changeId));
}

/** Active change ids, sorted. The archive directory is not a change. */
export async function listChanges(workspace: Workspace): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(workspace.changesPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== ARCHIVE_DIR)
    .map((entry) => entry.name)
    .sort();
}

export async function listArchivedChanges(workspace: Workspace): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(workspace.archivePath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
