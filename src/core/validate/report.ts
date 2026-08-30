export type IssueLevel = 'ERROR' | 'WARNING' | 'INFO';

export interface ValidationIssue {
  level: IssueLevel;
  /** Dotted location, e.g. `proposal.why` or `specs/user-auth/spec.md`. */
  path: string;
  message: string;
  line?: number;
}

export interface ValidationReport {
  /** Item id, e.g. a change name or a capability path. */
  item: string;
  type: 'change' | 'spec';
  valid: boolean;
  issues: ValidationIssue[];
  summary: { errors: number; warnings: number; info: number };
}

export function buildReport(
  item: string,
  type: ValidationReport['type'],
  issues: ValidationIssue[],
  strict: boolean
): ValidationReport {
  const errors = issues.filter((issue) => issue.level === 'ERROR').length;
  const warnings = issues.filter((issue) => issue.level === 'WARNING').length;
  const info = issues.filter((issue) => issue.level === 'INFO').length;

  return {
    item,
    type,
    // Strict mode is the only difference in verdict: the same issues are
    // collected either way, warnings just stop being tolerated.
    valid: errors === 0 && (!strict || warnings === 0),
    issues,
    summary: { errors, warnings, info },
  };
}
