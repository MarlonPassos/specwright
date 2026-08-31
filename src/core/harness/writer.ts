import path from 'node:path';
import { writeFileEnsured } from '../../util/fs.js';
import { workflowCommands } from '../workflows/index.js';
import { resolveCommand } from './invocation.js';
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
  return workflowCommands().map((command) => ({
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
