import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pathExists } from '../../util/fs.js';
import { headerLines } from '../markdown/sections.js';
import { removalNotes } from '../markdown/deltas.js';
import { parseProposal, readDeltaSpecs, readTaskProgress, PROPOSAL_FILE } from '../change/model.js';
import { readChangeMetadata } from '../change/metadata.js';
import { readSpec } from '../specs.js';
import { changeDir, type Workspace } from '../workspace.js';
import { buildReport, type ValidationIssue, type ValidationReport } from './report.js';
import {
  MAX_DELTAS_PER_CHANGE,
  MAX_WHY_LENGTH,
  MESSAGES,
  MIN_PURPOSE_LENGTH,
  MIN_WHY_LENGTH,
  isPurposePlaceholder,
} from './rules.js';
import { validateRequirement } from './spec-validator.js';

export interface ValidateChangeOptions {
  strict?: boolean;
  /** Also require every tracked task to be checked. Used for archived changes. */
  requireCompletedTasks?: boolean;
}

export async function validateChange(
  workspace: Workspace,
  changeId: string,
  options: ValidateChangeOptions = {},
  dirOverride?: string
): Promise<ValidationReport> {
  const dir = dirOverride ?? changeDir(workspace, changeId);
  const issues: ValidationIssue[] = [];

  issues.push(...(await validateProposal(dir)));

  const metadata = await readChangeMetadata(dir);
  const deltaSpecs = await readDeltaSpecs(dir);
  const deltaCount = deltaSpecs.reduce((count, spec) => count + spec.entries.length, 0);

  if (metadata.malformed) {
    issues.push({ level: 'ERROR', path: '.change.yaml', message: MESSAGES.SKIP_SPECS_MALFORMED });
  }

  if (metadata.skipSpecs && deltaSpecs.length > 0) {
    issues.push({ level: 'ERROR', path: '.change.yaml', message: MESSAGES.SKIP_SPECS_CONFLICT });
  }

  if (!metadata.skipSpecs && deltaCount === 0) {
    issues.push({ level: 'ERROR', path: 'specs/', message: MESSAGES.NO_DELTAS });
  }

  if (deltaCount > MAX_DELTAS_PER_CHANGE) {
    issues.push({ level: 'WARNING', path: 'specs/', message: MESSAGES.TOO_MANY_DELTAS });
  }

  for (const spec of deltaSpecs) {
    issues.push(...(await validateDeltaSpec(workspace, spec)));
  }

  issues.push(...(await validateTasks(dir, options.requireCompletedTasks === true)));

  return buildReport(changeId, 'change', issues, options.strict === true);
}

async function validateProposal(dir: string): Promise<ValidationIssue[]> {
  const proposalPath = path.join(dir, PROPOSAL_FILE);
  if (!(await pathExists(proposalPath))) {
    return [{ level: 'ERROR', path: PROPOSAL_FILE, message: MESSAGES.PROPOSAL_MISSING }];
  }

  const content = await fs.readFile(proposalPath, 'utf8');
  const proposal = parseProposal(content);
  const headers = headerLines(content).filter((header) => header.level === 2);
  const issues: ValidationIssue[] = [];

  const hasWhy = headers.some((header) => /^why$/i.test(header.title));
  const hasWhat = headers.some((header) => /^what changes$/i.test(header.title));

  if (!hasWhy) {
    issues.push({ level: 'ERROR', path: `${PROPOSAL_FILE}#why`, message: MESSAGES.WHY_MISSING });
  } else if (stripComments(proposal.why).length < MIN_WHY_LENGTH) {
    issues.push({ level: 'ERROR', path: `${PROPOSAL_FILE}#why`, message: MESSAGES.WHY_TOO_SHORT });
  } else if (stripComments(proposal.why).length > MAX_WHY_LENGTH) {
    issues.push({ level: 'WARNING', path: `${PROPOSAL_FILE}#why`, message: MESSAGES.WHY_TOO_LONG });
  }

  if (!hasWhat) {
    issues.push({
      level: 'ERROR',
      path: `${PROPOSAL_FILE}#what-changes`,
      message: MESSAGES.WHAT_MISSING,
    });
  } else if (!stripComments(proposal.whatChanges)) {
    issues.push({
      level: 'ERROR',
      path: `${PROPOSAL_FILE}#what-changes`,
      message: MESSAGES.WHAT_EMPTY,
    });
  }

  return issues;
}

/** Template placeholders are HTML comments; they never count as authored content. */
function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s-]+$/gm, '')
    .trim();
}

async function validateDeltaSpec(
  workspace: Workspace,
  spec: Awaited<ReturnType<typeof readDeltaSpecs>>[number]
): Promise<ValidationIssue[]> {
  const location = `specs/${spec.capability}/spec.md`;
  const issues: ValidationIssue[] = [];

  if (spec.sections.length === 0) {
    issues.push({ level: 'ERROR', path: location, message: MESSAGES.DELTA_NO_SECTIONS });
  }

  const existing = await readSpec(workspace, spec.capability);
  const existingNames = new Set(existing?.spec.requirements.map((r) => r.name) ?? []);
  const isNewCapability = existing === undefined;

  if (isNewCapability) {
    if (!spec.purpose) {
      issues.push({
        level: 'WARNING',
        path: location,
        message:
          'New capability delta has no "## Purpose" section. Without it the main spec created at ' +
          'archive time carries a placeholder',
      });
    } else if (isPurposePlaceholder(spec.purpose)) {
      issues.push({ level: 'WARNING', path: location, message: MESSAGES.SPEC_PURPOSE_PLACEHOLDER });
    } else if (spec.purpose.length < MIN_PURPOSE_LENGTH) {
      issues.push({ level: 'WARNING', path: location, message: MESSAGES.SPEC_PURPOSE_TOO_BRIEF });
    }
  }

  for (const entry of spec.entries) {
    const where = `${location} > ${entry.operation}`;

    if (entry.operation === 'ADDED' || entry.operation === 'MODIFIED') {
      issues.push(...validateRequirement(entry.requirement!, `${where}: ${entry.requirement!.name}`));
    }

    if (entry.operation === 'ADDED' && existingNames.has(entry.requirement!.name)) {
      issues.push({
        level: 'WARNING',
        path: `${where}: ${entry.requirement!.name}`,
        message: MESSAGES.DELTA_ADDED_EXISTS,
      });
    }

    if (entry.operation === 'REMOVED') {
      const notes = removalNotes(entry.requirement!);
      if (!notes.reason) {
        issues.push({
          level: 'WARNING',
          path: `${where}: ${entry.requirement!.name}`,
          message: MESSAGES.REMOVED_NO_REASON,
        });
      }
      if (!notes.migration) {
        issues.push({
          level: 'WARNING',
          path: `${where}: ${entry.requirement!.name}`,
          message: MESSAGES.REMOVED_NO_MIGRATION,
        });
      }
    }

    const targetsExisting =
      entry.operation === 'MODIFIED' || entry.operation === 'REMOVED' || entry.operation === 'RENAMED';
    if (!targetsExisting) continue;

    if (isNewCapability) {
      issues.push({ level: 'ERROR', path: where, message: MESSAGES.DELTA_UNKNOWN_CAPABILITY });
      continue;
    }

    const targetName =
      entry.operation === 'RENAMED' ? entry.rename!.from : entry.requirement!.name;
    if (!existingNames.has(targetName)) {
      issues.push({
        level: 'ERROR',
        path: `${where}: ${targetName}`,
        message: MESSAGES.DELTA_MISSING_REQUIREMENT,
      });
    }
  }

  return issues;
}

async function validateTasks(dir: string, requireCompleted: boolean): Promise<ValidationIssue[]> {
  const progress = await readTaskProgress(dir);
  if (!progress) return [];

  const issues: ValidationIssue[] = [];
  const seen = new Map<string, number>();
  let previous: number[] | undefined;
  let currentGroup: string | undefined;

  for (const task of progress.tasks) {
    if (!task.number) continue;

    if (task.group !== currentGroup) {
      currentGroup = task.group;
      previous = undefined;
    }

    const firstLine = seen.get(task.number);
    if (firstLine !== undefined) {
      issues.push({
        level: 'WARNING',
        path: 'tasks.md',
        line: task.line,
        message: `${MESSAGES.TASK_NUMBER_DUPLICATE}: ${task.number} (first on line ${firstLine})`,
      });
    } else {
      seen.set(task.number, task.line);
    }

    const parts = task.number.split('.').map(Number);
    if (previous && compareNumbers(parts, previous) <= 0) {
      issues.push({
        level: 'WARNING',
        path: 'tasks.md',
        line: task.line,
        message: `${MESSAGES.TASK_NUMBER_OUT_OF_ORDER}: ${task.number}`,
      });
    }
    previous = parts;
  }

  if (requireCompleted && progress.completed < progress.total) {
    issues.push({
      level: 'ERROR',
      path: 'tasks.md',
      message: `${MESSAGES.TASKS_INCOMPLETE}: ${progress.completed}/${progress.total} complete`,
    });
  }

  return issues;
}

function compareNumbers(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
