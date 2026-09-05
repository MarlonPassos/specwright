import { describe, expect, it } from 'vitest';
import {
  allHarnesses,
  getHarness,
  harnessIds,
  invocationFor,
  resolveHarnesses,
} from '../../src/core/harness/registry.js';
import { detectHarness } from '../../src/core/harness/current.js';
import { renderCommandRefs, resolveCommand } from '../../src/core/harness/invocation.js';
import { renderHarness, renderHarnesses } from '../../src/core/harness/writer.js';
import {
  allCommandIds,
  allCommands,
  commandName,
  commandRef,
  projectCommands,
  workflowCommand,
  workflowCommands,
} from '../../src/core/workflows/index.js';

const EXPECTED_HARNESSES = ['claude', 'codex', 'opencode', 'kiro'];
const EXPECTED_WORKFLOW_COMMANDS = ['explore', 'propose', 'continue', 'revise', 'implement', 'verify', 'archive'];
const EXPECTED_PROJECT_COMMANDS = [
  'project-plan',
  'project-review',
  'project-generate',
  'project-status',
  'project-next',
  'project-propose-batch',
  'project-refine',
];
const EXPECTED_COMMANDS = [...EXPECTED_WORKFLOW_COMMANDS, ...EXPECTED_PROJECT_COMMANDS];

/** How each harness spells a command, and therefore what its files may contain. */
const EXPECTED_INVOCATION: Record<string, (id: string) => string> = {
  claude: (id) => `/spec-${id}`,
  opencode: (id) => `/spec-${id}`,
  kiro: (id) => `/spec-${id}`,
  codex: (id) => `$spec-${id}`,
};

/** Every command reference a generated file could carry, in any harness. */
const ANY_INVOCATION = /[/$]spec-[a-z][a-z-]*/g;

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
  it('exposes the seven workflow commands', () => {
    expect(workflowCommands().map((command) => command.id)).toEqual(EXPECTED_WORKFLOW_COMMANDS);
  });

  it('exposes the seven plan commands and a catalogue of fourteen', () => {
    expect(projectCommands().map((command) => command.id)).toEqual(EXPECTED_PROJECT_COMMANDS);
    expect(allCommands()).toHaveLength(14);
    expect(allCommandIds()).toEqual(EXPECTED_COMMANDS);
  });

  it('defines explore as an optional, read-only thinking mode', () => {
    const explore = workflowCommand('explore');

    expect(explore).toMatchObject({
      id: 'explore',
      name: 'Spec Explore',
      argumentHint: '[o que você quer pensar]',
    });
    expect(explore?.description).toContain('modo exploração');
    expect(explore?.body).toContain('não para implementar');
    expect(explore?.body).toContain('Antes da primeira ação que escreve');
    expect(explore?.body).toContain('specs list --json');
    expect(explore?.body).toContain(commandRef('propose'));
    // The body never hard-codes one harness's syntax; it only carries placeholders.
    expect(explore?.body).not.toMatch(ANY_INVOCATION);
  });

  it('defines revise as a planning-only rework of artifacts that already exist', () => {
    const revise = workflowCommand('revise');

    expect(revise).toMatchObject({
      id: 'revise',
      name: 'Spec Revise',
      argumentHint: '[nome-da-change] [o que mudou]',
    });
    // It reworks what exists and never advances the build frontier.
    expect(revise?.body).toContain('só revisa o que já existe');
    expect(revise?.body).toContain('nunca cria um artefato que falta');
    expect(revise?.body).toContain(commandRef('continue'));
    // It edits the concrete files status reports, never the declared pattern.
    expect(revise?.body).toContain('São esses os arquivos que você pode editar');
    expect(revise?.body).toContain('Nunca escreva nesse caminho');
    expect(revise?.body).toContain('não ramifique');
    // Planning only: code changes belong to implement.
    expect(revise?.body).toContain('Nunca edite o código do projeto');
    expect(revise?.body).toContain(commandRef('implement'));
    // Every edit is confirmed first, and an intent change opens a new change.
    expect(revise?.body).toContain('Escreva só depois que o usuário confirmar');
    expect(revise?.body).toContain(commandRef('propose'));
    expect(revise?.body).toContain('specs status --change "<change>" --json');
    expect(revise?.body).toContain('specs validate "<change>" --strict --json');
    expect(revise?.body).not.toMatch(ANY_INVOCATION);
  });

  it('names every command with the spec- prefix in every harness', () => {
    for (const adapter of allHarnesses()) {
      for (const command of workflowCommands()) {
        expect(adapter.filePath(command.id)).toContain(`spec-${command.id}`);
      }
    }
    expect(commandName('archive')).toBe('spec-archive');
  });

  it('writes each harness to its own directory', () => {
    const paths = Object.fromEntries(
      allHarnesses().map((adapter) => [adapter.id, adapter.filePath('propose')])
    );
    expect(paths.claude).toBe('.claude/commands/spec-propose.md');
    expect(paths.codex).toBe('.agents/skills/spec-propose/SKILL.md');
    expect(paths.opencode).toBe('.opencode/commands/spec-propose.md');
    expect(paths.kiro).toBe('.kiro/prompts/spec-propose.prompt.md');
  });

  it('opens every file with YAML frontmatter carrying a description', () => {
    for (const file of renderHarnesses(allHarnesses())) {
      expect(file.content.startsWith('---\n')).toBe(true);
      expect(file.content).toMatch(/\ndescription: "/);
    }
  });

  it('keeps the instruction body identical across harnesses once invocations are normalised', () => {
    const bodies = allHarnesses().map((adapter) => {
      const file = renderHarness(adapter).find((entry) => entry.command === 'continue')!;
      // Only the command syntax may differ, so folding it back to a single token
      // must leave the same text in every harness.
      return file.content.split('\n---\n')[1].trim().replace(ANY_INVOCATION, '<cmd>');
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

  it('renders explore for every harness with its safety instructions', () => {
    const files = renderHarnesses(allHarnesses()).filter((file) => file.command === 'explore');

    expect(files).toHaveLength(EXPECTED_HARNESSES.length);
    expect(files.map((file) => file.harness)).toEqual(EXPECTED_HARNESSES);
    for (const file of files) {
      expect(file.content).toContain('Modo exploração é para pensar, não para implementar.');
      expect(file.content).toContain('Antes da primeira ação que escreve');
      expect(file.content).toContain(EXPECTED_INVOCATION[file.harness]('explore'));
    }
  });

  it('passes explore input through OpenCode and keeps it implicit elsewhere', () => {
    const opencode = renderHarness(getHarness('opencode')!).find((entry) => entry.command === 'explore')!;
    const claude = renderHarness(getHarness('claude')!).find((entry) => entry.command === 'explore')!;

    expect(opencode.content).toContain('**Input** ([o que você quer pensar]): $ARGUMENTS');
    expect(claude.content).not.toContain('$ARGUMENTS');
  });

  it('restricts Claude Code commands to this CLI', () => {
    const file = renderHarness(getHarness('claude')!)[0];
    expect(file.content).toContain('allowed-tools: Bash(specs:*)');
  });

  it('cross-references sibling commands by the name every harness registers', () => {
    for (const file of renderHarnesses(allHarnesses())) {
      const references = file.content.match(ANY_INVOCATION) ?? [];
      for (const reference of references) {
        expect(EXPECTED_COMMANDS.map(EXPECTED_INVOCATION[file.harness])).toContain(reference);
      }
    }
  });

  it('leaves no unresolved command placeholder in a generated file', () => {
    for (const file of renderHarnesses(allHarnesses())) {
      expect(file.content).not.toContain('{{spec-command:');
    }
  });
});

describe('command invocations', () => {
  it('spells commands the way each harness accepts them', () => {
    for (const adapter of allHarnesses()) {
      for (const id of EXPECTED_COMMANDS) {
        expect(adapter.invocation(id)).toBe(EXPECTED_INVOCATION[adapter.id](id));
      }
    }
  });

  it('renders a body with only the running harness\'s syntax', () => {
    for (const adapter of allHarnesses()) {
      const text = renderCommandRefs(`Rode ${commandRef('implement')} depois.`, adapter);

      expect(text).toBe(`Rode ${EXPECTED_INVOCATION[adapter.id]('implement')} depois.`);
      for (const other of allHarnesses()) {
        if (other.id === adapter.id) continue;
        const foreign = EXPECTED_INVOCATION[other.id]('implement');
        if (foreign === EXPECTED_INVOCATION[adapter.id]('implement')) continue;
        expect(text).not.toContain(foreign);
      }
    }
  });

  it('resolves the description and the argument hint too, not just the body', () => {
    const codex = getHarness('codex')!;
    const resolved = resolveCommand(
      {
        id: 'demo',
        name: 'Demo',
        description: `depois de ${commandRef('continue')}`,
        argumentHint: `saída de ${commandRef('propose')}`,
        body: `rode ${commandRef('verify')}`,
      },
      codex
    );

    expect(resolved.description).toBe('depois de $spec-continue');
    expect(resolved.argumentHint).toBe('saída de $spec-propose');
    expect(resolved.body).toBe('rode $spec-verify');
  });

  it('rejects a reference to a command that does not exist', () => {
    expect(() => renderCommandRefs('{{spec-command:ghost}}', getHarness('claude')!)).toThrow(
      /Referência a um comando inexistente: ghost/
    );
  });

  it('falls back to the default harness when the id is unknown', () => {
    expect(invocationFor('codex', 'continue')).toBe('$spec-continue');
    expect(invocationFor('ghost', 'continue')).toBe('/spec-continue');
    expect(invocationFor(undefined, 'continue')).toBe('/spec-continue');
  });
});

describe('detecting the running harness', () => {
  it('honours an explicit SPECS_HARNESS over everything else', () => {
    const adapter = detectHarness({
      env: { SPECS_HARNESS: 'codex', CLAUDECODE: '1' },
      configured: ['claude'],
    });
    expect(adapter.id).toBe('codex');
  });

  it('rejects an unknown SPECS_HARNESS instead of guessing', () => {
    expect(() => detectHarness({ env: { SPECS_HARNESS: 'ghost' } })).toThrow(
      /não é um harness suportado/
    );
  });

  it('reads the environment the harness itself sets', () => {
    expect(detectHarness({ env: { CLAUDECODE: '1' } }).id).toBe('claude');
    expect(detectHarness({ env: { CODEX_SANDBOX: 'seatbelt' } }).id).toBe('codex');
    expect(detectHarness({ env: { OPENCODE: '1' } }).id).toBe('opencode');
    expect(detectHarness({ env: { KIRO_IDE: '1' } }).id).toBe('kiro');
  });

  it('prefers a configured harness when several environments look active', () => {
    const env = { CLAUDECODE: '1', CODEX_HOME: '/home/u/.codex' };
    expect(detectHarness({ env, configured: ['codex'] }).id).toBe('codex');
    expect(detectHarness({ env, configured: ['claude', 'codex'] }).id).toBe('claude');
  });

  it('falls back to the configuration, then to the first supported harness', () => {
    expect(detectHarness({ env: {}, configured: ['kiro'] }).id).toBe('kiro');
    expect(detectHarness({ env: {} }).id).toBe('claude');
  });

  it('ignores an empty marker, which is how a shell exports an unset variable', () => {
    expect(detectHarness({ env: { CODEX_HOME: '' }, configured: ['kiro'] }).id).toBe('kiro');
  });
});
