import { describe, expect, it } from 'vitest';
import { buildFenceMask, findSection, headerLines, parseSections } from '../../src/core/markdown/sections.js';
import { parseMainSpec, parseRequirements } from '../../src/core/markdown/requirements.js';
import { parseDeltaSpec, parseRenames, removalNotes } from '../../src/core/markdown/deltas.js';
import { parseTasks } from '../../src/core/change/model.js';

describe('section parsing', () => {
  it('ignores headers inside fenced code blocks', () => {
    const content = ['## Real', '', '```md', '## Fake', '```', '', '## Other'].join('\n');
    expect(buildFenceMask(content.split('\n')).filter(Boolean).length).toBe(3);
    expect(headerLines(content).map((header) => header.title)).toEqual(['Real', 'Other']);
  });

  it('finds a section nested under an H1 title', () => {
    const content = ['# Title', '', '## Purpose', '', 'text'].join('\n');
    expect(findSection(parseSections(content), 'Purpose')?.content).toBe('text');
  });

  it('stops a section at the next header of the same or lower level', () => {
    const content = ['## A', 'a-text', '### A1', 'nested', '## B', 'b-text'].join('\n');
    const sections = parseSections(content);
    expect(findSection(sections, 'A')?.content).toBe('a-text\n### A1\nnested');
    expect(findSection(sections, 'B')?.content).toBe('b-text');
  });
});

describe('requirement parsing', () => {
  const content = [
    '## ADDED Requirements',
    '',
    '### Documentation Requirements',
    'not a requirement header',
    '',
    '### Requirement: Export',
    'The system SHALL export data.',
    '',
    '#### Scenario: Works',
    '- **WHEN** asked',
    '- **THEN** it exports',
  ].join('\n');

  it('reads only real requirement headers, with their scenarios', () => {
    const section = parseSections(content)[0];
    const requirements = parseRequirements(section, content);
    expect(requirements).toHaveLength(1);
    expect(requirements[0].name).toBe('Export');
    expect(requirements[0].text).toBe('The system SHALL export data.');
    expect(requirements[0].scenarios.map((scenario) => scenario.name)).toEqual(['Works']);
  });

  it('keeps the whole authored block so a merge can carry it across', () => {
    const section = parseSections(content)[0];
    expect(parseRequirements(section, content)[0].raw).toContain('#### Scenario: Works');
  });

  it('reads a main spec purpose and requirements', () => {
    const spec = parseMainSpec(
      'data-export',
      ['# Data Export', '', '## Purpose', '', 'Purpose text.', '', '## Requirements', '', '### Requirement: A', 'The system SHALL a.', '', '#### Scenario: S', '- **WHEN** x', '- **THEN** y'].join('\n')
    );
    expect(spec.purpose).toBe('Purpose text.');
    expect(spec.requirements.map((requirement) => requirement.name)).toEqual(['A']);
  });
});

describe('delta parsing', () => {
  const content = [
    '## Purpose',
    '',
    'A purpose.',
    '',
    '## ADDED Requirements',
    '',
    '### Requirement: New thing',
    'The system SHALL do the new thing.',
    '',
    '#### Scenario: S',
    '- **WHEN** x',
    '- **THEN** y',
    '',
    '## REMOVED Requirements',
    '',
    '### Requirement: Old thing',
    '**Reason**: replaced',
    '**Migration**: use the new thing',
    '',
    '## RENAMED Requirements',
    '',
    '- FROM: `### Requirement: Before`',
    '- TO: `### Requirement: After`',
  ].join('\n');

  it('collects one entry per operation', () => {
    const parsed = parseDeltaSpec('data-export', content);
    expect(parsed.purpose).toBe('A purpose.');
    expect(parsed.sections).toEqual(['ADDED', 'REMOVED', 'RENAMED']);
    expect(parsed.entries.map((entry) => entry.operation)).toEqual(['ADDED', 'REMOVED', 'RENAMED']);
    expect(parsed.entries[2].rename).toEqual({ from: 'Before', to: 'After' });
  });

  it('reads the reason and migration of a removal', () => {
    const removed = parseDeltaSpec('data-export', content).entries[1];
    expect(removalNotes(removed.requirement!)).toEqual({
      reason: 'replaced',
      migration: 'use the new thing',
    });
  });

  it('accepts renames written without backticks', () => {
    expect(parseRenames('FROM: ### Requirement: A\nTO: ### Requirement: B')).toEqual([
      { from: 'A', to: 'B' },
    ]);
  });
});

describe('task parsing', () => {
  it('counts checked and unchecked boxes and keeps their group', () => {
    const progress = parseTasks(
      ['## 1. Setup', '- [x] 1.1 done thing', '- [ ] 1.2 pending thing', '', '## 2. Ship', '- [ ] 2.1 ship it'].join('\n')
    );
    expect(progress.total).toBe(3);
    expect(progress.completed).toBe(1);
    expect(progress.tasks[0].group).toBe('1. Setup');
    expect(progress.tasks[2].number).toBe('2.1');
  });

  it('ignores a line that is not a checkbox', () => {
    expect(parseTasks('- 1.1 no checkbox here').total).toBe(0);
  });
});
