import path from 'node:path';
import { promises as fs } from 'node:fs';
import { findFilesNamed, pathExists } from '../util/fs.js';
import { parseMainSpec, type MainSpec } from './markdown/requirements.js';
import type { Workspace } from './workspace.js';

export const SPEC_FILE = 'spec.md';

export interface SpecEntry {
  /** Capability path relative to the workspace specs directory, POSIX-separated. */
  capability: string;
  filePath: string;
}

/** Every capability with a main spec in the workspace, sorted by path. */
export async function listSpecs(workspace: Workspace): Promise<SpecEntry[]> {
  if (!(await pathExists(workspace.specsPath))) return [];

  return (await findFilesNamed(workspace.specsPath, SPEC_FILE))
    .map((relative) => ({
      capability: relative.slice(0, -(SPEC_FILE.length + 1)),
      filePath: path.join(workspace.specsPath, ...relative.split('/')),
    }))
    .filter((entry) => entry.capability.length > 0);
}

export function specPath(workspace: Workspace, capability: string): string {
  return path.join(workspace.specsPath, ...capability.split('/'), SPEC_FILE);
}

export async function readSpec(
  workspace: Workspace,
  capability: string
): Promise<{ spec: MainSpec; content: string; filePath: string } | undefined> {
  const filePath = specPath(workspace, capability);
  if (!(await pathExists(filePath))) return undefined;
  const content = await fs.readFile(filePath, 'utf8');
  return { spec: parseMainSpec(capability, content), content, filePath };
}
