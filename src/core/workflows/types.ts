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

/** How a user invokes the command. */
export function invocation(id: string): string {
  return `/${commandName(id)}`;
}
