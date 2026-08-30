import { headerLines } from '../markdown/sections.js';
import { parseMainSpec } from '../markdown/requirements.js';
import { buildReport, type ValidationIssue, type ValidationReport } from './report.js';
import {
  MAX_REQUIREMENT_TEXT_LENGTH,
  MESSAGES,
  MIN_PURPOSE_LENGTH,
  isPurposePlaceholder,
} from './rules.js';

const DELTA_HEADER = /^(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements$/i;
const REQUIREMENT_HEADER = /^Requirement:\s*(.+)$/i;

export function hasNormativeKeyword(text: string): boolean {
  return /\b(SHALL|MUST)\b/.test(text);
}

/**
 * Structural problems that make part of a main spec invisible to every reader:
 * delta headers (which truncate the requirements section), requirements placed
 * outside `## Requirements`, and duplicate requirement names.
 */
export function findStructureIssues(content: string, location: string): ValidationIssue[] {
  const headers = headerLines(content);
  const issues: ValidationIssue[] = [];

  const requirementsHeader = headers.find(
    (header) => header.level === 2 && /^requirements$/i.test(header.title)
  );
  const nextTopLevel = requirementsHeader
    ? headers.find((header) => header.level === 2 && header.line > requirementsHeader.line)
    : undefined;
  const sectionEnd = nextTopLevel?.line ?? Number.MAX_SAFE_INTEGER;
  const seen = new Map<string, number>();

  for (const header of headers) {
    if (header.level === 2 && DELTA_HEADER.test(header.title)) {
      issues.push({
        level: 'ERROR',
        path: location,
        line: header.line,
        message: `${MESSAGES.SPEC_DELTA_HEADER}: "## ${header.title}"`,
      });
      continue;
    }

    const match = header.level === 3 ? REQUIREMENT_HEADER.exec(header.title) : null;
    if (!match) continue;

    const inside =
      requirementsHeader !== undefined &&
      header.line > requirementsHeader.line &&
      header.line < sectionEnd;

    if (!inside) {
      issues.push({
        level: 'ERROR',
        path: location,
        line: header.line,
        message: `${MESSAGES.SPEC_REQUIREMENT_OUTSIDE}: "### ${header.title}"`,
      });
      continue;
    }

    const name = match[1].trim();
    const previous = seen.get(name);
    if (previous !== undefined) {
      issues.push({
        level: 'ERROR',
        path: location,
        line: header.line,
        message: `${MESSAGES.SPEC_DUPLICATE_REQUIREMENT}: "${name}" (first declared on line ${previous})`,
      });
    } else {
      seen.set(name, header.line);
    }
  }

  return issues;
}

export function validateSpecContent(
  capability: string,
  content: string,
  options: { strict?: boolean } = {}
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const spec = parseMainSpec(capability, content);
  const location = `specs/${capability}/spec.md`;
  const hasPurposeHeader = headerLines(content).some(
    (header) => header.level === 2 && /^purpose$/i.test(header.title)
  );

  if (!hasPurposeHeader) {
    issues.push({ level: 'ERROR', path: location, message: MESSAGES.SPEC_PURPOSE_MISSING });
  } else if (!spec.purpose) {
    issues.push({ level: 'ERROR', path: location, message: MESSAGES.SPEC_PURPOSE_EMPTY });
  } else if (isPurposePlaceholder(spec.purpose)) {
    issues.push({ level: 'WARNING', path: location, message: MESSAGES.SPEC_PURPOSE_PLACEHOLDER });
  } else if (spec.purpose.length < MIN_PURPOSE_LENGTH) {
    issues.push({ level: 'WARNING', path: location, message: MESSAGES.SPEC_PURPOSE_TOO_BRIEF });
  }

  if (spec.requirements.length === 0) {
    issues.push({ level: 'ERROR', path: location, message: MESSAGES.SPEC_NO_REQUIREMENTS });
  }

  for (const requirement of spec.requirements) {
    issues.push(...validateRequirement(requirement, `${location} > ${requirement.name}`));
  }

  issues.push(...findStructureIssues(content, location));

  return buildReport(capability, 'spec', issues, options.strict === true);
}

/** Shared requirement checks - a main spec requirement and an ADDED/MODIFIED delta obey the same rules. */
export function validateRequirement(
  requirement: { name: string; text: string; scenarios: Array<{ name: string; text: string }>; line: number },
  location: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!requirement.text.trim()) {
    issues.push({
      level: 'ERROR',
      path: location,
      line: requirement.line,
      message: MESSAGES.REQUIREMENT_EMPTY,
    });
  } else if (!hasNormativeKeyword(requirement.text)) {
    issues.push({
      level: 'ERROR',
      path: location,
      line: requirement.line,
      message: MESSAGES.REQUIREMENT_NO_KEYWORD,
    });
  } else if (requirement.text.length > MAX_REQUIREMENT_TEXT_LENGTH) {
    issues.push({
      level: 'WARNING',
      path: location,
      line: requirement.line,
      message: MESSAGES.REQUIREMENT_TOO_LONG,
    });
  }

  if (requirement.scenarios.length === 0) {
    issues.push({
      level: 'ERROR',
      path: location,
      line: requirement.line,
      message: MESSAGES.REQUIREMENT_NO_SCENARIO,
    });
  }

  for (const scenario of requirement.scenarios) {
    if (!scenario.text.trim()) {
      issues.push({
        level: 'ERROR',
        path: `${location} > ${scenario.name}`,
        message: MESSAGES.SCENARIO_EMPTY,
      });
    }
  }

  return issues;
}
