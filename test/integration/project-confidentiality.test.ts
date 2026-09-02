import path from 'node:path';
import { promises as fs } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeTempDir, runCli, writeFile } from '../helpers/workspace.js';

const CANARY = 'SEGREDO-CANARIO';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

beforeAll(async () => {
  await fs.stat(path.join(process.cwd(), 'dist', 'cli', 'index.js'));
});

describe('confidentiality (NFR-09, AC-61)', () => {
  it('the source marker never reaches planning/ nor any command output', async () => {
    const dir = await makeTempDir();
    await runCli(['init', '.', '--json'], dir);
    await writeFile(
      path.join(dir, 'docs/vision.md'),
      `# Visão\n\nUm documento com o marcador ${CANARY} plantado no meio.\n`
    );

    const outputs: string[] = [];
    outputs.push((await runCli(['project', 'create', 'p', 'docs/vision.md', '--json'], dir)).stdout);

    // Drive the whole planning flow through the CLI.
    const bundle = JSON.stringify({
      bundleVersion: 1,
      expectRevision: 0,
      operations: [
        {
          op: 'addChange',
          ref: '$a',
          slug: 'foundation',
          title: 'Fundação',
          plannedChange: { objetivo: 'Base do sistema.', escopo: ['estrutura'], criteriosMacro: ['build verde'] },
        },
      ],
    });
    await writeFile(path.join(dir, 'b.json'), bundle);
    outputs.push((await runCli(['project', 'apply', '--file', 'b.json', '--json'], dir)).stdout);
    outputs.push((await runCli(['project', 'generate', '--json'], dir)).stdout);
    outputs.push((await runCli(['project', 'status', '--json'], dir)).stdout);
    outputs.push((await runCli(['project', 'next', '--json'], dir)).stdout);
    outputs.push((await runCli(['project', 'show', 'CH-001', '--json'], dir)).stdout);
    outputs.push((await runCli(['project', 'validate', '--json'], dir)).stdout);

    for (const output of outputs) {
      expect(output).not.toContain(CANARY);
    }

    for (const file of await walk(path.join(dir, 'planning'))) {
      expect(await fs.readFile(file, 'utf8'), file).not.toContain(CANARY);
    }
  });
});
