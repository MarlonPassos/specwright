import { describe, expect, it } from 'vitest';
import { allHarnesses, getHarness, harnessIds, resolveHarnesses } from '../../src/core/harness/registry.js';
import { renderHarness, renderHarnesses } from '../../src/core/harness/writer.js';
import { commandName, invocation, workflowCommands } from '../../src/core/workflows/index.js';

const EXPECTED_HARNESSES = ['claude', 'codex', 'opencode', 'kiro'];
const EXPECTED_COMMANDS = ['propose', 'plan', 'implement', 'verify', 'archive'];

describe('harness registry', () => {
  it('supports exactly the four target harnesses', () => {
    expect(harnessIds().sort()).toEqual([...EXPECTED_HARNESSES].sort());
  });

  it('resolves "all" and an explicit list to the same registry order', () => {
    expect(resolveHarnesses('all').map((adapter) => adapter.id)).toEqual(harnessIds());
    expect(resolveHarnesses('kiro,claude').map((adapter) => adapter.id)).toEqual(['claude', 'kiro']);
    expect(resolveHarnesses('claude,claude').map((adapter) => adapter.id)).toEqual(['claude']);
  });

  it('rejects an unknown harness rather than silently skipping it', () => {
    expect(() => resolveHarnesses('claude,nope')).toThrow(/Harness desconhecido: nope/);
  });
});

describe('generated commands', () => {
  it('exposes the five workflow commands', () => {
    expect(workflowCommands().map((command) => command.id)).toEqual(EXPECTED_COMMANDS);
  });

  it('names every command with the spec- prefix in every harness', () => {
    for (const adapter of allHarnesses()) {
      for (const command of workflowCommands()) {
        expect(adapter.filePath(command.id)).toContain(`spec-${command.id}`);
      }
    }
    expect(invocation('propose')).toBe('/spec-propose');
    expect(commandName('archive')).toBe('spec-archive');
  });

  it('writes each harness to its own directory', () => {
    const paths = Object.fromEntries(
      allHarnesses().map((adapter) => [adapter.id, adapter.filePath('propose')])
    );
    expect(paths.claude).toBe('.claude/commands/spec-propose.md');
    expect(paths.codex).toBe('.codex/prompts/spec-propose.md');
    expect(paths.opencode).toBe('.opencode/commands/spec-propose.md');
    expect(paths.kiro).toBe('.kiro/prompts/spec-propose.prompt.md');
  });

  it('opens every file with YAML frontmatter carrying a description', () => {
    for (const file of renderHarnesses(allHarnesses())) {
      expect(file.content.startsWith('---\n')).toBe(true);
      expect(file.content).toMatch(/\ndescription: "/);
    }
  });

  it('keeps the instruction body identical across harnesses', () => {
    const bodies = allHarnesses().map((adapter) => {
      const file = renderHarness(adapter).find((entry) => entry.command === 'plan')!;
      return file.content.split('\n---\n')[1].trim();
    });
    const reference = bodies[0];
    for (const body of bodies) {
      // OpenCode is the one harness that needs an argument placeholder appended;
      // everything before it must be the same text in every harness.
      expect(body.startsWith(reference.split('\n\n**Input**')[0])).toBe(true);
    }
  });

  it('gives OpenCode the argument placeholder it needs to receive input', () => {
    const file = renderHarness(getHarness('opencode')!).find((entry) => entry.command === 'propose')!;
    expect(file.content).toContain('$ARGUMENTS');
    const claude = renderHarness(getHarness('claude')!).find((entry) => entry.command === 'propose')!;
    expect(claude.content).not.toContain('$ARGUMENTS');
  });

  it('restricts Claude Code commands to this CLI', () => {
    const file = renderHarness(getHarness('claude')!)[0];
    expect(file.content).toContain('allowed-tools: Bash(specs:*)');
  });

  it('cross-references sibling commands by the name every harness registers', () => {
    for (const file of renderHarnesses(allHarnesses())) {
      const references = file.content.match(/\/spec-[a-z]+/g) ?? [];
      for (const reference of references) {
        expect(EXPECTED_COMMANDS.map((id) => `/spec-${id}`)).toContain(reference);
      }
    }
  });
});
