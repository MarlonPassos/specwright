/** Thresholds every validation message is derived from. */
export const MIN_WHY_LENGTH = 50;
export const MAX_WHY_LENGTH = 1000;
export const MIN_PURPOSE_LENGTH = 50;
export const MAX_REQUIREMENT_TEXT_LENGTH = 500;
export const MAX_DELTAS_PER_CHANGE = 10;

/**
 * The Purpose written into a main spec that archiving had to create without one.
 * Composed from these halves at both the write site and the check, so the
 * detector cannot drift away from the text it is looking for.
 */
export const PURPOSE_PLACEHOLDER_PREFIX = 'TBD - written while archiving change ';
export const PURPOSE_PLACEHOLDER_SUFFIX = '. Replace it with the real purpose.';

export function purposePlaceholder(changeId: string): string {
  return `${PURPOSE_PLACEHOLDER_PREFIX}${changeId}${PURPOSE_PLACEHOLDER_SUFFIX}`;
}

/** True when a Purpose is still a placeholder rather than something someone wrote. */
export function isPurposePlaceholder(purpose: string): boolean {
  const text = purpose.trim();
  if (!text) return false;
  if (text.startsWith(PURPOSE_PLACEHOLDER_PREFIX)) return true;
  return /^(TBD|TODO)\b/i.test(text);
}

export const MESSAGES = {
  PROPOSAL_MISSING: 'proposal.md is missing',
  WHY_MISSING: 'Missing "## Why" section',
  WHY_TOO_SHORT: `The "## Why" section must be at least ${MIN_WHY_LENGTH} characters`,
  WHY_TOO_LONG: `The "## Why" section should stay under ${MAX_WHY_LENGTH} characters`,
  WHAT_MISSING: 'Missing "## What Changes" section',
  WHAT_EMPTY: 'The "## What Changes" section is empty',
  NO_DELTAS:
    'No spec deltas found. Add specs/<capability-path>/spec.md files using delta headers ' +
    '(## ADDED/MODIFIED/REMOVED/RENAMED Requirements), each requirement carrying at least one ' +
    '"#### Scenario:" block. If this change alters no observable behavior, set "skip_specs: true" ' +
    'in the change .change.yaml instead.',
  SKIP_SPECS_CONFLICT:
    'skip_specs is set but delta spec files exist under specs/. Remove the marker or delete the deltas',
  SKIP_SPECS_MALFORMED:
    'skip_specs looks set but .change.yaml is not valid change metadata, so the marker is ignored',
  TOO_MANY_DELTAS: `More than ${MAX_DELTAS_PER_CHANGE} deltas - consider splitting this change`,
  DELTA_NO_SECTIONS:
    'No delta section found. A delta spec needs at least one of "## ADDED Requirements", ' +
    '"## MODIFIED Requirements", "## REMOVED Requirements" or "## RENAMED Requirements"',
  REQUIREMENT_EMPTY: 'Requirement text is empty',
  REQUIREMENT_NO_KEYWORD: 'Requirement text must use SHALL or MUST',
  REQUIREMENT_NO_SCENARIO:
    'Requirement has no scenario. Add a "#### Scenario:" block with WHEN/THEN bullets ' +
    '(exactly four hashes - three hashes or a bullet list is not parsed)',
  REQUIREMENT_TOO_LONG: `Requirement text is very long (over ${MAX_REQUIREMENT_TEXT_LENGTH} characters) - consider splitting it`,
  SCENARIO_EMPTY: 'Scenario has no content',
  REMOVED_NO_REASON: 'A REMOVED requirement must carry a "**Reason**:" line',
  REMOVED_NO_MIGRATION: 'A REMOVED requirement must carry a "**Migration**:" line',
  SPEC_PURPOSE_MISSING: 'Missing "## Purpose" section',
  SPEC_PURPOSE_EMPTY: 'The "## Purpose" section is empty',
  SPEC_PURPOSE_TOO_BRIEF: `The "## Purpose" section is shorter than ${MIN_PURPOSE_LENGTH} characters`,
  SPEC_PURPOSE_PLACEHOLDER:
    'The "## Purpose" section is still a placeholder. Replace it with what this capability is for, ' +
    'editing the main spec directly - a "## Purpose" in a delta is read only when the capability ' +
    'is created',
  SPEC_NO_REQUIREMENTS: 'Missing "## Requirements" section, or it declares no requirement',
  SPEC_DELTA_HEADER:
    'Delta headers belong in a change delta, not in a main spec, and they cut the parsed ' +
    '"## Requirements" section short',
  SPEC_REQUIREMENT_OUTSIDE:
    'Requirement declared outside the "## Requirements" section, so nothing reads it',
  SPEC_DUPLICATE_REQUIREMENT: 'Duplicate requirement name - names must be unique inside a spec',
  DELTA_UNKNOWN_CAPABILITY:
    'Delta targets a capability that does not exist in the workspace specs. Use ADDED for a new ' +
    'capability, or fix the capability path',
  DELTA_MISSING_REQUIREMENT:
    'Delta targets a requirement that the workspace spec does not declare. Header text must match exactly',
  DELTA_ADDED_EXISTS:
    'ADDED requirement already exists in the workspace spec - use MODIFIED to change it',
  TASK_NUMBER_OUT_OF_ORDER: 'Task numbers are out of order inside their group',
  TASK_NUMBER_DUPLICATE: 'Duplicate task number',
  TASKS_INCOMPLETE: 'Change has unchecked tasks',
} as const;
