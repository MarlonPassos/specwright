import { describe, expect, it } from 'vitest';
import { allHarnesses } from '../../src/core/harness/registry.js';
import { renderHarness, renderHarnesses } from '../../src/core/harness/writer.js';
import { projectCommands, allCommands } from '../../src/core/workflows/index.js';

const PROJECT_IDS = [
  'project-plan',
  'project-review',
  'project-generate',
  'project-status',
  'project-next',
  'project-propose-batch',
  'project-refine',
];

describe('project harness commands', () => {
  it('are the seven documented ids', () => {
    expect(projectCommands().map((command) => command.id)).toEqual(PROJECT_IDS);
  });

  it('generate 14 commands × 4 harnesses = 56 files with unique paths', () => {
    const files = renderHarnesses(allHarnesses());
    expect(files).toHaveLength(allCommands().length * 4);
    expect(files).toHaveLength(56);
    expect(new Set(files.map((file) => file.path)).size).toBe(56);
  });

  it('never leak another harness\'s invocation syntax or a raw placeholder', () => {
    for (const adapter of allHarnesses()) {
      for (const file of renderHarness(adapter)) {
        expect(file.content).not.toContain('{{spec-command:');
        const foreign = adapter.id === 'codex' ? /\/spec-[a-z]/ : /\$spec-[a-z]/;
        expect(file.content, file.path).not.toMatch(foreign);
      }
    }
  });

  it('give project-plan the read tools and project-status the default (AC-57)', () => {
    const claude = allHarnesses().find((adapter) => adapter.id === 'claude')!;
    const files = Object.fromEntries(renderHarness(claude).map((file) => [file.command, file.content]));
    expect(files['project-plan']).toContain('allowed-tools: Bash(specs:*), Read, Glob, Grep');
    expect(files['project-generate']).toContain('allowed-tools: Bash(specs:*), Read');
    expect(files['project-status']).toContain('allowed-tools: Bash(specs:*)\n');
    expect(files['continue']).toContain('allowed-tools: Bash(specs:*)\n');
  });

  it('every project body carries the macro boundary and the evidence labels', () => {
    for (const command of projectCommands()) {
      expect(command.body).toContain('trabalha o PLANO do projeto, nunca uma change');
      expect(command.body).toContain('Rotule a origem de cada afirmação');
    }
  });

  it('a plan body references sibling commands only through placeholders', () => {
    for (const command of projectCommands()) {
      expect(command.body).not.toMatch(/[/$]spec-[a-z]/);
    }
  });
});
