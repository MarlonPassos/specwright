import type { WorkflowCommand } from '../workflows/types.js';

export interface HarnessAdapter {
  /** Stable identifier used by `--harnesses` and stored in the workspace config. */
  id: string;
  /** Display name. */
  name: string;
  /** Directory the adapter owns, relative to the project root. Reported to users. */
  directory: string;
  /** Path of one command file, relative to the project root. */
  filePath(commandId: string): string;
  /** Complete file content, frontmatter included. */
  format(command: WorkflowCommand): string;
}

/** Quotes a scalar for YAML frontmatter. */
export function yamlScalar(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
