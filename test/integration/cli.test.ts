import path from 'node:path';
import { promises as fs } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeTempDir, parseJson, runCli, seedChange, writeFile } from '../helpers/workspace.js';
import { workspaceAt } from '../../src/core/workspace.js';

async function initProject(): Promise<string> {
  const dir = await makeTempDir();
  const result = await runCli(['init', '.', '--json'], dir);
  expect(result.code).toBe(0);
  return dir;
}

beforeAll(async () => {
  // The CLI runs from dist/, which the pretest build produces.
  await fs.stat(path.join(process.cwd(), 'dist', 'cli', 'index.js'));
});

describe('spec CLI', () => {
  it('reports the harnesses and commands it supports', async () => {
    const dir = await makeTempDir();
    const result = await runCli(['harnesses', '--json'], dir);
    const payload = parseJson(result.stdout);

    expect(payload.harnesses.map((harness: any) => harness.id)).toEqual([
      'claude',
      'codex',
      'opencode',
      'kiro',
    ]);
    expect(payload.commands.map((command: any) => command.name)).toEqual([
      'spec-explore',
      'spec-propose',
      'spec-plan',
      'spec-implement',
      'spec-verify',
      'spec-archive',
    ]);

    const byId = Object.fromEntries(
      payload.harnesses.map((harness: any) => [harness.id, harness.invocations])
    );
    expect(byId.claude.plan).toBe('/spec-plan');
    expect(byId.opencode.plan).toBe('/spec-plan');
    expect(byId.kiro.plan).toBe('/spec-plan');
    expect(byId.codex.plan).toBe('$spec-plan');
  });

  it('suggests the next step in the syntax of the harness it is running under', async () => {
    const dir = await makeTempDir();

    const codex = await runCli(['init', '.'], dir, { env: { SPECS_HARNESS: 'codex' } });
    expect(codex.stdout).toContain('Próximo passo');
    expect(codex.stdout).toContain('$spec-propose');
    expect(codex.stdout).not.toContain('/spec-propose');

    const claude = await runCli(['init', '.'], dir, { env: { SPECS_HARNESS: 'claude' } });
    expect(claude.stdout).toContain('/spec-propose');
    expect(claude.stdout).not.toContain('$spec-propose');
  });

  it('spells the status hints for the harness it is running under', async () => {
    const dir = await initProject();

    const payload = parseJson(
      (await runCli(['status', '--json'], dir, { env: { SPECS_HARNESS: 'codex' } })).stdout
    );
    expect(payload.harness).toBe('codex');

    const plain = await runCli(['status'], dir, { env: { SPECS_HARNESS: 'codex' } });
    expect(plain.stdout).not.toContain('/spec-');
  });

  it('writes each harness its own command syntax', async () => {
    const dir = await initProject();
    const codex = await fs.readFile(
      path.join(dir, '.agents', 'skills', 'spec-plan', 'SKILL.md'),
      'utf8'
    );
    const claude = await fs.readFile(path.join(dir, '.claude', 'commands', 'spec-plan.md'), 'utf8');

    expect(codex).toContain('$spec-implement');
    expect(codex).not.toContain('/spec-implement');
    expect(claude).toContain('/spec-implement');
    expect(claude).not.toContain('$spec-implement');
  });

  it('initialises a workspace and writes the harness files', async () => {
    const dir = await initProject();
    const listing = parseJson((await runCli(['init', '.', '--json'], dir)).stdout);

    expect(listing.created).toBe(false);
    expect(listing.files).toHaveLength(24);
    for (const file of listing.files) {
      await expect(fs.stat(path.join(dir, file))).resolves.toBeTruthy();
    }
  });

  it('regenerates command files with update', async () => {
    const dir = await initProject();
    const target = path.join(dir, '.claude', 'commands', 'spec-plan.md');
    await fs.writeFile(target, 'stale', 'utf8');

    const result = await runCli(['update', '--json'], dir);
    expect(result.code).toBe(0);
    expect(await fs.readFile(target, 'utf8')).toContain('specs status --change');
  });

  it('creates a change and reports its status as JSON', async () => {
    const dir = await initProject();
    expect((await runCli(['new', 'change', 'add-data-export', '--json'], dir)).code).toBe(0);

    const status = parseJson((await runCli(['status', '--change', 'add-data-export', '--json'], dir)).stdout);
    expect(status.schema).toBe('spec-driven');
    expect(status.ready).toBe(false);
    expect(status.next).toEqual(['proposal']);
    expect(status.applyRequires).toEqual(['proposal', 'specs', 'design', 'tasks']);
  });

  it('rejects a change name that is not kebab-case', async () => {
    const dir = await initProject();
    const result = await runCli(['new', 'change', 'Add Export', '--json'], dir);

    expect(result.code).toBe(1);
    expect(parseJson(result.stdout).error.code).toBe('invalid_change_name');
  });

  it('serves artifact instructions as JSON', async () => {
    const dir = await initProject();
    await runCli(['new', 'change', 'add-data-export'], dir);

    const instructions = parseJson(
      (await runCli(['instructions', 'proposal', '--change', 'add-data-export', '--json'], dir)).stdout
    );
    expect(instructions.kind).toBe('artifact');
    expect(instructions.artifact).toBe('proposal');
    expect(instructions.template).toContain('## Why');
    expect(instructions.outputPath.endsWith(path.join('add-data-export', 'proposal.md'))).toBe(true);
  });

  it('defaults to the next artifact when none is named', async () => {
    const dir = await initProject();
    await runCli(['new', 'change', 'add-data-export'], dir);
    const instructions = parseJson(
      (await runCli(['instructions', '--change', 'add-data-export', '--json'], dir)).stdout
    );
    expect(instructions.artifact).toBe('proposal');
  });

  it('exits 1 when validation fails and 0 when it passes', async () => {
    const dir = await initProject();
    const workspace = workspaceAt(dir);
    await seedChange(workspace, 'add-data-export');

    const passing = await runCli(['validate', 'add-data-export', '--strict', '--json'], dir);
    expect(passing.code).toBe(0);
    expect(parseJson(passing.stdout).valid).toBe(true);

    await writeFile(
      path.join(workspace.changesPath, 'add-data-export', 'proposal.md'),
      '## Why\n\nshort\n\n## What Changes\n\n- x\n'
    );
    const failing = await runCli(['validate', 'add-data-export', '--json'], dir);
    expect(failing.code).toBe(1);
    expect(parseJson(failing.stdout).valid).toBe(false);
  });

  it('reports a missing workspace as a JSON error with a fix', async () => {
    const dir = await makeTempDir();
    const result = await runCli(['list', '--json'], dir);

    expect(result.code).toBe(1);
    const payload = parseJson(result.stdout);
    expect(payload.changes).toEqual([]);
    expect(payload.error.code).toBe('workspace_not_found');
    expect(payload.error.fix).toBe('specs init');
  });

  it('archives a finished change and merges its specs', async () => {
    const dir = await initProject();
    const workspace = workspaceAt(dir);
    await seedChange(workspace, 'add-data-export', {
      tasks: '## 1. Export\n\n- [x] 1.1 Implement the writer and verify its unit test passes\n',
    });

    const archived = parseJson((await runCli(['archive', 'add-data-export', '--json'], dir)).stdout);
    expect(archived.createdSpecs).toEqual(['data-export']);

    const specs = parseJson((await runCli(['list', '--specs', '--json'], dir)).stdout);
    expect(specs.specs).toEqual([
      { capability: 'data-export', requirements: 1, purpose: expect.any(String) },
    ]);

    const changes = parseJson((await runCli(['list', '--json'], dir)).stdout);
    expect(changes.changes).toEqual([]);
  });

  it('refuses to archive a change with unchecked tasks', async () => {
    const dir = await initProject();
    await seedChange(workspaceAt(dir), 'add-data-export');

    const result = await runCli(['archive', 'add-data-export', '--json'], dir);
    expect(result.code).toBe(1);
    expect(parseJson(result.stdout).error.code).toBe('tasks_incomplete');
  });

  it('validates archived changes for complete task lists', async () => {
    const dir = await initProject();
    const workspace = workspaceAt(dir);
    await seedChange(workspace, 'add-data-export', {
      tasks: '## 1. Export\n\n- [x] 1.1 Implement the writer and verify its unit test passes\n',
    });
    await runCli(['archive', 'add-data-export'], dir);

    const archivedDirs = await fs.readdir(workspace.archivePath);
    await writeFile(
      path.join(workspace.archivePath, archivedDirs[0], 'tasks.md'),
      '## 1. Export\n\n- [ ] 1.1 Implement the writer and verify its unit test passes\n'
    );

    const result = await runCli(['validate', '--archived', '--json'], dir);
    expect(result.code).toBe(1);
    expect(parseJson(result.stdout).summary.errors).toBeGreaterThan(0);
  });

  it('lists the schemas it can run and the templates they use', async () => {
    const dir = await initProject();

    const schemas = parseJson((await runCli(['schemas', '--json'], dir)).stdout);
    expect(schemas.active).toBe('spec-driven');
    expect(schemas.schemas.map((schema: any) => schema.name)).toContain('spec-driven');

    const templates = parseJson((await runCli(['templates', '--json'], dir)).stdout);
    expect(templates.artifacts.map((artifact: any) => artifact.artifact)).toEqual([
      'proposal',
      'specs',
      'design',
      'tasks',
    ]);
  });

  it('shows a change and its deltas', async () => {
    const dir = await initProject();
    await seedChange(workspaceAt(dir), 'add-data-export');

    const shown = parseJson((await runCli(['show', 'add-data-export', '--json', '--deltas-only'], dir)).stdout);
    expect(shown.deltas).toHaveLength(1);
    expect(shown.deltas[0].operation).toBe('ADDED');
  });
});
