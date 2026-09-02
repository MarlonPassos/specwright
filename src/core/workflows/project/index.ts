import type { WorkflowCommand } from '../types.js';
import { projectPlanCommand } from './plan.js';
import { projectReviewCommand } from './review.js';
import { projectGenerateCommand } from './generate.js';
import { projectStatusCommand } from './status.js';
import { projectNextCommand } from './next.js';
import { projectRefineCommand } from './refine.js';

/** The six plan commands, in the order a plan is walked. */
export function projectCommands(): WorkflowCommand[] {
  return [
    projectPlanCommand(),
    projectReviewCommand(),
    projectGenerateCommand(),
    projectStatusCommand(),
    projectNextCommand(),
    projectRefineCommand(),
  ];
}
