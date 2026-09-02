import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allHarnesses } from '../../src/core/harness/registry.js';
import { renderHarnesses } from '../../src/core/harness/writer.js';
import { allCommands } from '../../src/core/workflows/index.js';
import { projectRoot } from '../helpers/workspace.js';

const CLI = 'specs';
const COMMAND_PREFIX = 'spec-';
const HARNESS_NAMES = ['Claude Code', 'Codex', 'OpenCode', 'Kiro'];

async function readText(...segments: string[]): Promise<string> {
  return fs.readFile(path.join(projectRoot, ...segments), 'utf8');
}

/** Every markdown file that ships with the project, docs and templates included. */
async function shippedDocs(): Promise<string[]> {
  const roots = ['README.md', 'docs', 'schemas'];
  const files: string[] = [];

  const walk = async (target: string): Promise<void> => {
    const stats = await fs.stat(target).catch(() => undefined);
    if (!stats) return;
    if (stats.isFile()) {
      if (target.endsWith('.md') || target.endsWith('.yaml')) files.push(target);
      return;
    }
    for (const entry of await fs.readdir(target)) await walk(path.join(target, entry));
  };

  for (const root of roots) await walk(path.join(projectRoot, root));
  return files;
}

describe('project identity', () => {
  it('ships one CLI binary, named after the workflow', async () => {
    const manifest = JSON.parse(await readText('package.json'));
    expect(Object.keys(manifest.bin)).toEqual([CLI]);
  });

  it('generates only spec-prefixed commands', () => {
    for (const file of renderHarnesses(allHarnesses())) {
      // A harness names either the file after the command, or the directory holding it.
      const prefixed =
        path.basename(file.path).startsWith(COMMAND_PREFIX) ||
        path.basename(path.dirname(file.path)).startsWith(COMMAND_PREFIX);
      expect(prefixed, file.path).toBe(true);
    }
  });

  it('invokes only its own CLI from every generated command body', () => {
    const invocations = new Set<string>();
    for (const file of renderHarnesses(allHarnesses())) {
      for (const line of file.content.split('\n')) {
        const match = /^\s*([a-z][a-z0-9-]*) [a-z]/.exec(line.trim());
        if (line.trim().startsWith('specs ') && match) invocations.add(match[1]);
      }
    }
    expect([...invocations]).toEqual([CLI]);
  });

  it('documents exactly the four supported harnesses', async () => {
    const readme = await readText('README.md');
    for (const name of HARNESS_NAMES) {
      expect(readme).toContain(name);
    }
    expect(allHarnesses().map((adapter) => adapter.name).sort()).toEqual([...HARNESS_NAMES].sort());
  });

  it('documents every workflow command in the readme', async () => {
    const readme = await readText('README.md');
    for (const command of allCommands()) {
      expect(readme).toContain(`/${COMMAND_PREFIX}${command.id}`);
    }
  });

  it('documents explore as an optional mode outside the delivery cycle', async () => {
    const workflow = await readText('docs/workflow.md');

    expect(workflow).toContain('## /spec-explore');
    expect(workflow).toContain('O modo `/spec-explore` é opcional');
    expect(workflow).toContain('Exploração não implementa código.');
  });

  it('keeps shipped documents free of absolute paths from a developer machine', async () => {
    for (const file of await shippedDocs()) {
      const content = await fs.readFile(file, 'utf8');
      expect(content, file).not.toMatch(/\/(Users|home)\/[a-z]/i);
    }
  });
});
