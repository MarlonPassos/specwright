import { describe, expect, it } from 'vitest';
import { mergeCapability, splitSpec, joinSpec, specSkeleton } from '../../src/core/archive/merge.js';
import { parseDeltaSpec } from '../../src/core/markdown/deltas.js';
import { parseMainSpec } from '../../src/core/markdown/requirements.js';
import { PURPOSE_PLACEHOLDER_PREFIX } from '../../src/core/validate/rules.js';

const MAIN = [
  '# Data Export Specification',
  '',
  '## Purpose',
  '',
  'Lets a signed-in user take their own data out of the product.',
  '',
  '## Requirements',
  '',
  '### Requirement: Export',
  'The system SHALL export data.',
  '',
  '#### Scenario: Works',
  '- **WHEN** asked',
  '- **THEN** it exports',
  '',
  '### Requirement: Audit',
  'The system SHALL record every export.',
  '',
  '#### Scenario: Recorded',
  '- **WHEN** an export runs',
  '- **THEN** the audit log gains an entry',
  '',
].join('\n');

function entries(delta: string) {
  return parseDeltaSpec('data-export', delta).entries;
}

describe('splitSpec / joinSpec', () => {
  it('round-trips a spec without changing it', () => {
    expect(joinSpec(splitSpec(MAIN)).trim()).toBe(MAIN.trim());
  });

  it('rejects a spec with no requirements section', () => {
    expect(() => splitSpec('## Purpose\n\ntext')).toThrow(/no "## Requirements" section/);
  });

  it('preserves content that follows the requirements section', () => {
    const withTail = `${MAIN}\n## Notes\n\nkeep me\n`;
    expect(joinSpec(splitSpec(withTail))).toContain('## Notes\n\nkeep me');
  });
});

describe('mergeCapability', () => {
  it('appends an ADDED requirement', () => {
    const result = mergeCapability(
      'data-export',
      entries('## ADDED Requirements\n\n### Requirement: Schedule\nThe system SHALL schedule exports.\n\n#### Scenario: S\n- **WHEN** x\n- **THEN** y'),
      { existing: MAIN, changeId: 'c' }
    );
    const spec = parseMainSpec('data-export', result.content);
    expect(spec.requirements.map((requirement) => requirement.name)).toEqual(['Export', 'Audit', 'Schedule']);
    expect(result.applied).toEqual(['ADDED Schedule']);
  });

  it('replaces a MODIFIED requirement wholesale', () => {
    const result = mergeCapability(
      'data-export',
      entries('## MODIFIED Requirements\n\n### Requirement: Export\nThe system SHALL export active data only.\n\n#### Scenario: Filtered\n- **WHEN** x\n- **THEN** y'),
      { existing: MAIN, changeId: 'c' }
    );
    const spec = parseMainSpec('data-export', result.content);
    expect(spec.requirements.map((requirement) => requirement.name)).toEqual(['Export', 'Audit']);
    expect(result.content).toContain('active data only');
    expect(result.content).not.toContain('#### Scenario: Works');
  });

  it('deletes a REMOVED requirement', () => {
    const result = mergeCapability(
      'data-export',
      entries('## REMOVED Requirements\n\n### Requirement: Audit\n**Reason**: r\n**Migration**: m'),
      { existing: MAIN, changeId: 'c' }
    );
    expect(parseMainSpec('data-export', result.content).requirements.map((r) => r.name)).toEqual(['Export']);
    expect(result.empty).toBe(false);
  });

  it('renames a requirement and keeps its body', () => {
    const result = mergeCapability(
      'data-export',
      entries('## RENAMED Requirements\n\n- FROM: `### Requirement: Export`\n- TO: `### Requirement: Data export`'),
      { existing: MAIN, changeId: 'c' }
    );
    const spec = parseMainSpec('data-export', result.content);
    expect(spec.requirements.map((requirement) => requirement.name)).toEqual(['Data export', 'Audit']);
    expect(result.content).toContain('#### Scenario: Works');
  });

  it('reports the capability as retired when the last requirement goes', () => {
    const delta = [
      '## REMOVED Requirements',
      '',
      '### Requirement: Export',
      '**Reason**: r',
      '**Migration**: m',
      '',
      '### Requirement: Audit',
      '**Reason**: r',
      '**Migration**: m',
    ].join('\n');
    expect(mergeCapability('data-export', entries(delta), { existing: MAIN, changeId: 'c' }).empty).toBe(true);
  });

  it('builds a new spec around the delta purpose', () => {
    const result = mergeCapability(
      'data-export',
      entries('## ADDED Requirements\n\n### Requirement: Export\nThe system SHALL export.\n\n#### Scenario: S\n- **WHEN** x\n- **THEN** y'),
      { purpose: 'Lets a user export their data.', changeId: 'c' }
    );
    expect(result.content).toContain('# Data Export Specification');
    expect(result.content).toContain('Lets a user export their data.');
  });

  it('leaves a placeholder purpose when the delta supplied none', () => {
    const result = mergeCapability(
      'data-export',
      entries('## ADDED Requirements\n\n### Requirement: Export\nThe system SHALL export.\n\n#### Scenario: S\n- **WHEN** x\n- **THEN** y'),
      { changeId: 'add-data-export' }
    );
    expect(result.content).toContain(PURPOSE_PLACEHOLDER_PREFIX);
  });

  it('refuses to modify a requirement that is not there', () => {
    expect(() =>
      mergeCapability(
        'data-export',
        entries('## MODIFIED Requirements\n\n### Requirement: Ghost\nThe system SHALL ghost.\n\n#### Scenario: S\n- **WHEN** x\n- **THEN** y'),
        { existing: MAIN, changeId: 'c' }
      )
    ).toThrow(/does not declare/);
  });

  it('matches requirement names whitespace-insensitively', () => {
    const result = mergeCapability(
      'data-export',
      entries('## REMOVED Requirements\n\n### Requirement:   export  \n**Reason**: r\n**Migration**: m'),
      { existing: MAIN, changeId: 'c' }
    );
    expect(parseMainSpec('data-export', result.content).requirements.map((r) => r.name)).toEqual(['Audit']);
  });

  it('titles a nested capability from its last path segment', () => {
    expect(specSkeleton('identity/user-auth', 'x')).toContain('# User Auth Specification');
  });
});
