import { commandName, type WorkflowCommand } from '../workflows/types.js';

export interface HarnessAdapter {
  /** Stable identifier used by `--harnesses` and stored in the workspace config. */
  id: string;
  /** Display name. */
  name: string;
  /** Directory the adapter owns, relative to the project root. Reported to users. */
  directory: string;
  /**
   * Environment variables that, when set, mean this harness is the one running.
   * Used to pick the syntax the CLI prints its next-step hints in.
   */
  envMarkers: string[];
  /**
   * Whether this harness's own running session can fan out to a native
   * subagent primitive of its own - the mechanism `/spec-implement`'s
   * parallel branch needs to dispatch a worktree-isolated batch. Absent or
   * false keeps every change on the sequential path for this harness,
   * regardless of a change's own opt-in.
   */
  supportsParallelDispatch?: boolean;
  /** Name of that primitive, surfaced to the operator - the CLI never invokes it itself. */
  parallelDispatchPrimitive?: string;
  /** Path of one command file, relative to the project root. */
  filePath(commandId: string): string;
  /**
   * How a user types one of the generated commands in this harness. The single
   * source of truth for every command reference shown to a user - instruction
   * bodies and CLI output alike resolve through it, so no message can suggest
   * another harness's syntax.
   */
  invocation(commandId: string): string;
  /** Complete file content, frontmatter included. */
  format(command: WorkflowCommand): string;
}

/** The `/spec-continue` form, which every harness but Codex uses. */
export function slashInvocation(commandId: string): string {
  return `/${commandName(commandId)}`;
}

/** Quotes a scalar for YAML frontmatter. */
export function yamlScalar(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
