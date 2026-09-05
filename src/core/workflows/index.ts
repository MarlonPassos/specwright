import { exploreCommand } from './explore.js';
import { proposeCommand } from './propose.js';
import { continueCommand } from './continue.js';
import { reviseCommand } from './revise.js';
import { implementCommand } from './implement.js';
import { verifyCommand } from './verify.js';
import { archiveCommand } from './archive.js';
import { projectCommands } from './project/index.js';
import { loopCommand } from './loop.js';
import type { WorkflowCommand } from './types.js';

export * from './types.js';
export { projectCommands } from './project/index.js';

/**
 * The workflow, in the order it is walked, with explore first: it sits outside
 * the cycle and can run before or during any step. Revise sits outside it too,
 * next to continue, because it reworks what continue already wrote. Every
 * harness generates exactly these commands from exactly these bodies, so a
 * command means the same thing whichever harness runs it.
 */
export function workflowCommands(): WorkflowCommand[] {
  return [
    exploreCommand(),
    proposeCommand(),
    continueCommand(),
    reviseCommand(),
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

/**
 * The complete catalogue: change-cycle commands, plan commands and the explicit
 * autonomous loop. `workflowCommands()` still returns only the cycle, so callers
 * that reason about the delivery loop are untouched.
 */
export function allCommands(): WorkflowCommand[] {
  return [...workflowCommands(), ...projectCommands(), loopCommand()];
}

export function allCommandIds(): string[] {
  return allCommands().map((command) => command.id);
}

export function anyCommand(id: string): WorkflowCommand | undefined {
  return allCommands().find((command) => command.id === id);
}
