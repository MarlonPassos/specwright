import path from 'node:path';
import { promises as fs } from 'node:fs';
import { writeFileEnsured } from '../../util/fs.js';
import { allCommands } from '../workflows/index.js';
import { resolveCommand } from './invocation.js';
import { allHarnesses } from './registry.js';
import type { HarnessAdapter } from './types.js';

export interface GeneratedFile {
  harness: string;
  command: string;
  /** Path relative to the project root. */
  path: string;
  content: string;
}

/** Renders every workflow command for one harness, without touching the disk. */
export function renderHarness(adapter: HarnessAdapter): GeneratedFile[] {
  return allCommands().map((command) => ({
    harness: adapter.id,
    command: command.id,
    path: adapter.filePath(command.id),
    content: adapter.format(resolveCommand(command, adapter)),
  }));
}

export function renderHarnesses(adapters: HarnessAdapter[]): GeneratedFile[] {
  return adapters.flatMap(renderHarness);
}

export async function writeHarnessFiles(
  projectRoot: string,
  adapters: HarnessAdapter[]
): Promise<GeneratedFile[]> {
  const files = renderHarnesses(adapters);
  for (const file of files) {
    await writeFileEnsured(path.join(projectRoot, file.path), file.content);
  }
  return files;
}

/**
 * Removes the command files of harnesses this workspace no longer declares.
 *
 * `init` used to materialise all four harnesses whenever nobody said otherwise,
 * and nothing ever took one away. In the project that motivated this, 60 of
 * 320 versioned files — 18.75 % — were harness prompts: four near-identical
 * variants of fifteen commands, in a project that used exactly one harness.
 *
 * Only files this writer itself produces are removed, computed from the same
 * `filePath` the generator uses, and only for adapters that are being dropped.
 * A file the user wrote inside `.claude/commands/` is not ours and is not
 * touched. A directory left empty afterwards is pruned; one that still holds
 * anything is left exactly as it is.
 */
export async function pruneHarnessFiles(
  projectRoot: string,
  keep: HarnessAdapter[]
): Promise<string[]> {
  const kept = new Set(keep.map((adapter) => adapter.id));
  const dropped = allHarnesses().filter((adapter) => !kept.has(adapter.id));
  const removed: string[] = [];

  for (const file of renderHarnesses(dropped)) {
    const absolute = path.join(projectRoot, file.path);
    try {
      await fs.unlink(absolute);
      removed.push(file.path);
    } catch {
      // Never existed, or is not ours to delete. Either way, nothing to report.
      continue;
    }
  }

  for (const dir of new Set(removed.map((file) => path.dirname(path.join(projectRoot, file))))) {
    await fs.rmdir(dir).catch(() => undefined);
  }

  return removed.sort();
}
