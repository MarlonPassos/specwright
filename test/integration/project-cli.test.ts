import path from 'node:path';
import { promises as fs } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeTempDir, parseJson, runCli, writeFile } from '../helpers/workspace.js';

async function initProject(): Promise<string> {
  const dir = await makeTempDir();
  expect((await runCli(['init', '.', '--json'], dir)).code).toBe(0);
  return dir;
}

beforeAll(async () => {
  await fs.stat(path.join(process.cwd(), 'dist', 'cli', 'index.js'));
});

describe('specs project — CLI', () => {
  it('creates a plan and emits the JSON contract', async () => {
    const dir = await initProject();
    await writeFile(path.join(dir, 'docs/vision.md'), '# Vision\n\nbig doc\n');

    const result = await runCli(
      ['project', 'create', 'ecommerce', 'docs/vision.md', '--name', 'E-commerce', '--json'],
      dir
    );
    expect(result.code).toBe(0);
    const payload = parseJson(result.stdout);
    expect(payload).toMatchObject({ plan: 'ecommerce', revision: 0, path: 'planning/ecommerce' });
    expect(payload.created).toContain('planning/ecommerce/plan.yaml');

    for (const file of ['plan.yaml', 'plan.md', 'architecture.md']) {
      await expect(fs.stat(path.join(dir, 'planning/ecommerce', file))).resolves.toBeTruthy();
    }
  });

  it('refuses a duplicate plan with plan_exists and exit 1', async () => {
    const dir = await initProject();
    expect((await runCli(['project', 'create', 'p', '--json'], dir)).code).toBe(0);

    const again = await runCli(['project', 'create', 'p', '--json'], dir);
    expect(again.code).toBe(1);
    expect(parseJson(again.stdout)).toMatchObject({ plan: null, error: { code: 'plan_exists' } });
  });

  it('validates a freshly created plan as clean', async () => {
    const dir = await initProject();
    await runCli(['project', 'create', 'p', '--json'], dir);

    const result = await runCli(['project', 'validate', 'p', '--json'], dir);
    expect(result.code).toBe(0);
    const payload = parseJson(result.stdout);
    expect(payload.valid).toBe(true);
    expect(payload.reports[0].type).toBe('plan');
  });

  it('reports plan_not_found for validate without a plan', async () => {
    const dir = await initProject();
    const result = await runCli(['project', 'validate', '--json'], dir);
    expect(result.code).toBe(1);
    expect(parseJson(result.stdout).error.code).toBe('plan_not_found');
  });

  it('outside a workspace it still returns workspace_not_found', async () => {
    const dir = await makeTempDir();
    const result = await runCli(['project', 'create', 'p', '--json'], dir);
    expect(result.code).toBe(1);
    expect(parseJson(result.stdout).error.code).toBe('workspace_not_found');
  });

  it('every project --json failure is a single JSON document with error.code', async () => {
    const dir = await initProject();
    const result = await runCli(['project', 'validate', 'nope', '--json'], dir);
    expect(() => parseJson(result.stdout)).not.toThrow();
    expect(parseJson(result.stdout).error.code).toBeTruthy();
  });
});

describe('specs project — no regression', () => {
  it('adding a plan does not change the output of existing commands', async () => {
    const dir = await initProject();
    const commands = [
      ['status', '--json'],
      ['list', '--json'],
      ['validate', '--all', '--json'],
      ['harnesses', '--json'],
      ['status'],
    ];

    const before = await Promise.all(commands.map((args) => runCli(args, dir)));
    expect((await runCli(['project', 'create', 'p', '--json'], dir)).code).toBe(0);
    const after = await Promise.all(commands.map((args) => runCli(args, dir)));

    for (let i = 0; i < commands.length; i += 1) {
      expect(after[i].stdout).toBe(before[i].stdout);
      expect(after[i].code).toBe(before[i].code);
    }
  });

  it('a corrupt plan.yaml does not break commands outside the project group', async () => {
    const dir = await initProject();
    await runCli(['project', 'create', 'p', '--json'], dir);
    await fs.writeFile(path.join(dir, 'planning/p/plan.yaml'), ':\n  - [ broken', 'utf8');

    for (const args of [['status', '--json'], ['list', '--json'], ['validate', '--all', '--json']]) {
      const result = await runCli(args, dir);
      expect(result.code).toBe(0);
    }
  });

  it('specs init never creates a planning area', async () => {
    const dir = await initProject();
    await expect(fs.stat(path.join(dir, 'planning'))).rejects.toThrow();
  });
});
