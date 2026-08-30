import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateChange } from '../../src/core/validate/change-validator.js';
import { validateSpecContent } from '../../src/core/validate/spec-validator.js';
import { purposePlaceholder } from '../../src/core/validate/rules.js';
import { DELTA_SPEC, makeWorkspace, seedChange, writeFile } from '../helpers/workspace.js';

function messages(report: { issues: Array<{ message: string; level: string }> }, level?: string) {
  return report.issues.filter((issue) => !level || issue.level === level).map((issue) => issue.message);
}

describe('change validation', () => {
  it('accepts a complete change', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'add-data-export');
    const report = await validateChange(workspace, 'add-data-export', { strict: true });
    expect(report.valid).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  it('rejects a missing proposal', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'add-data-export');
    await writeFile(path.join(dir, 'proposal.md'), '');
    const report = await validateChange(workspace, 'add-data-export');
    expect(report.valid).toBe(false);
    expect(messages(report, 'ERROR')).toContain('Falta a seção "## Why"');
  });

  it('rejects a Why section shorter than the minimum', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c', {
      proposal: '## Why\n\ntoo short\n\n## What Changes\n\n- something\n',
    });
    const report = await validateChange(workspace, 'c');
    expect(messages(report, 'ERROR').some((message) => message.includes('pelo menos 50'))).toBe(true);
  });

  it('treats an unfilled template section as empty', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c', {
      proposal: '## Why\n\n<!-- placeholder -->\n\n## What Changes\n\n- \n',
    });
    const report = await validateChange(workspace, 'c');
    expect(report.valid).toBe(false);
  });

  it('rejects a change with no deltas', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c', { delta: null as unknown as string });
    const report = await validateChange(workspace, 'c');
    expect(messages(report, 'ERROR').some((message) => message.startsWith('Nenhum delta de spec'))).toBe(true);
  });

  it('accepts a zero-delta change that declares skip_specs', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'c', { delta: null as unknown as string });
    await writeFile(path.join(dir, '.change.yaml'), 'schema: spec-driven\nskip_specs: true\n');
    const report = await validateChange(workspace, 'c');
    expect(report.valid).toBe(true);
  });

  it('rejects skip_specs alongside delta files', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'c');
    await writeFile(path.join(dir, '.change.yaml'), 'schema: spec-driven\nskip_specs: true\n');
    const report = await validateChange(workspace, 'c');
    expect(messages(report, 'ERROR').some((message) => message.includes('skip_specs está definido'))).toBe(true);
  });

  it('rejects a requirement with no scenario', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c', {
      delta: [
        '## Purpose',
        '',
        'A capability that lets people export their own data without asking support first.',
        '',
        '## ADDED Requirements',
        '',
        '### Requirement: Export',
        'The system SHALL export data.',
      ].join('\n'),
    });
    const report = await validateChange(workspace, 'c');
    expect(messages(report, 'ERROR').some((message) => message.includes('não tem cenário'))).toBe(true);
  });

  it('rejects a requirement with no SHALL or MUST', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c', {
      delta: DELTA_SPEC.replace('The system SHALL let', 'The system lets'),
    });
    const report = await validateChange(workspace, 'c');
    expect(messages(report, 'ERROR')).toContain('O texto do requisito precisa usar SHALL ou MUST');
  });

  it('rejects a MODIFIED delta whose requirement does not exist', async () => {
    const workspace = await makeWorkspace();
    await writeFile(
      path.join(workspace.specsPath, 'data-export', 'spec.md'),
      ['# Data Export', '', '## Purpose', '', 'Lets a user export their own data in a portable format, without support.', '', '## Requirements', '', '### Requirement: Existing', 'The system SHALL exist.', '', '#### Scenario: S', '- **WHEN** x', '- **THEN** y'].join('\n')
    );
    await seedChange(workspace, 'c', {
      delta: ['## MODIFIED Requirements', '', '### Requirement: Ghost', 'The system SHALL ghost.', '', '#### Scenario: S', '- **WHEN** x', '- **THEN** y'].join('\n'),
    });
    const report = await validateChange(workspace, 'c');
    expect(messages(report, 'ERROR').some((message) => message.includes('não declara'))).toBe(true);
  });

  it('rejects a MODIFIED delta against a capability that does not exist', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c', {
      delta: ['## MODIFIED Requirements', '', '### Requirement: Ghost', 'The system SHALL ghost.', '', '#### Scenario: S', '- **WHEN** x', '- **THEN** y'].join('\n'),
    });
    const report = await validateChange(workspace, 'c');
    expect(messages(report, 'ERROR').some((message) => message.includes('não existe nas specs do workspace'))).toBe(true);
  });

  it('warns about a removal with no reason or migration, and fails under strict', async () => {
    const workspace = await makeWorkspace();
    await writeFile(
      path.join(workspace.specsPath, 'data-export', 'spec.md'),
      ['# Data Export', '', '## Purpose', '', 'Lets a user export their own data in a portable format, without support.', '', '## Requirements', '', '### Requirement: Old', 'The system SHALL old.', '', '#### Scenario: S', '- **WHEN** x', '- **THEN** y'].join('\n')
    );
    await seedChange(workspace, 'c', {
      delta: ['## REMOVED Requirements', '', '### Requirement: Old'].join('\n'),
    });
    const lenient = await validateChange(workspace, 'c');
    expect(lenient.valid).toBe(true);
    expect(messages(lenient, 'WARNING').some((message) => message.includes('Reason'))).toBe(true);

    const strict = await validateChange(workspace, 'c', { strict: true });
    expect(strict.valid).toBe(false);
  });

  it('warns about out-of-order task numbers', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c', {
      tasks: ['## 1. Group', '- [ ] 1.2 second and verify', '- [ ] 1.1 first and verify'].join('\n'),
    });
    const report = await validateChange(workspace, 'c');
    expect(messages(report, 'WARNING').some((message) => message.includes('fora de ordem'))).toBe(true);
  });

  it('requires every task to be complete when asked to', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c');
    const report = await validateChange(workspace, 'c', { requireCompletedTasks: true });
    expect(messages(report, 'ERROR').some((message) => message.includes('tarefas não marcadas'))).toBe(true);
  });
});

describe('spec validation', () => {
  const valid = [
    '# Data Export',
    '',
    '## Purpose',
    '',
    'Lets a signed-in user export their own data in a portable format, without asking support.',
    '',
    '## Requirements',
    '',
    '### Requirement: Export',
    'The system SHALL export data.',
    '',
    '#### Scenario: S',
    '- **WHEN** x',
    '- **THEN** y',
  ].join('\n');

  it('accepts a well-formed spec', () => {
    expect(validateSpecContent('data-export', valid, { strict: true }).valid).toBe(true);
  });

  it('rejects a delta header in a main spec', () => {
    const report = validateSpecContent('data-export', valid.replace('## Requirements', '## ADDED Requirements'));
    expect(report.valid).toBe(false);
    expect(messages(report, 'ERROR').some((message) => message.includes('Cabeçalhos de delta pertencem'))).toBe(true);
  });

  it('rejects a requirement declared outside the requirements section', () => {
    const report = validateSpecContent(
      'data-export',
      `${valid}\n\n## Notes\n\n### Requirement: Stray\nThe system SHALL stray.\n\n#### Scenario: S\n- **WHEN** x\n- **THEN** y`
    );
    expect(messages(report, 'ERROR').some((message) => message.includes('fora da seção "## Requirements"'))).toBe(true);
  });

  it('rejects duplicate requirement names', () => {
    const report = validateSpecContent(
      'data-export',
      `${valid}\n\n### Requirement: Export\nThe system SHALL export twice.\n\n#### Scenario: S\n- **WHEN** x\n- **THEN** y`
    );
    expect(messages(report, 'ERROR').some((message) => message.includes('Nome de requisito duplicado'))).toBe(true);
  });

  it('warns when the purpose is still the placeholder archiving writes', () => {
    const report = validateSpecContent(
      'data-export',
      valid.replace(/Lets a signed-in.*support\./, purposePlaceholder('add-data-export'))
    );
    expect(messages(report, 'WARNING').some((message) => message.includes('placeholder'))).toBe(true);
    expect(report.valid).toBe(true);
  });
});
