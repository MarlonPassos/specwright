import { proposeCommand } from './propose.js';
import { planCommand } from './plan.js';
import { implementCommand } from './implement.js';
import { verifyCommand } from './verify.js';
import { archiveCommand } from './archive.js';
import type { WorkflowCommand } from './types.js';

export * from './types.js';

/**
 * The workflow, in the order it is walked. Every harness generates exactly
 * these commands from exactly these bodies, so a command means the same thing
 * whichever harness runs it.
 */
export function workflowCommands(): WorkflowCommand[] {
  return [
    proposeCommand(),
    planCommand(),
    implementCommand(),
    verifyCommand(),
    archiveCommand(),
  ];
}

export function workflowCommand(id: string): WorkflowCommand | undefined {
  return workflowCommands().find((command) => command.id === id);
}

export function workflowCommandIds(): string[] {
  return workflowCommands().map((command) => command.id);
}
