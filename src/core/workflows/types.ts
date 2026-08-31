export interface WorkflowCommand {
  /** Command id; the harness command is always `spec-<id>`. */
  id: string;
  /** Human-readable name shown by harnesses that display one. */
  name: string;
  description: string;
  /** What the user is expected to pass. Empty when nothing is required. */
  argumentHint: string;
  /** The instruction body, identical for every harness. */
  body: string;
}

/** What every generated command is called, in every harness. */
export function commandName(id: string): string {
  return `spec-${id}`;
}

/**
 * Placeholder for a sibling command inside a workflow body.
 *
 * How a command is typed differs per harness - `/spec-continue` in Claude Code,
 * `$spec-continue` in Codex - so a body never spells an invocation out. It writes
 * this marker and the harness layer swaps in the syntax of the harness the file
 * is being generated for. See `renderCommandRefs`.
 */
export function commandRef(id: string): string {
  return `{{spec-command:${id}}}`;
}

/** Matches what `commandRef` writes, capturing the command id. */
export const COMMAND_REF_PATTERN = /\{\{spec-command:([a-z][a-z0-9-]*)\}\}/g;
