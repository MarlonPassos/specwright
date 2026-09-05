import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pendingFollowUps, readFollowUps } from '../../src/core/change/followups.js';
import { archiveChange } from '../../src/core/archive/archive.js';
import { makeWorkspace, seedChange, writeFile } from '../helpers/workspace.js';

const DESIGN = (questions: string): string =>
  `## Contexto\n\nDemo.\n\n## Perguntas em Aberto\n\n${questions}\n`;

async function withDesign(questions: string): Promise<string> {
  const workspace = await makeWorkspace();
  const dir = await seedChange(workspace, 'c');
  await writeFile(path.join(dir, 'design.md'), DESIGN(questions));
  return dir;
}

describe('readFollowUps', () => {
  it('reads a follow-up and leaves a plain question alone', async () => {
    const dir = await withDesign(
      '- [ ] Q-1 · adiável — Qual TTL usar no cache?\n' +
        '- [ ] FU-1 · follow-up — Campos de cliente exigem migration'
    );

    expect(await readFollowUps(dir)).toEqual([
      { id: 'FU-1', text: 'Campos de cliente exigem migration', dispatched: false },
    ]);
  });

  it('a ticked box means somebody gave it a destination', async () => {
    const dir = await withDesign('- [x] FU-1 · follow-up — virou CH-042');

    expect(pendingFollowUps(await readFollowUps(dir))).toEqual([]);
  });

  it('is empty when the design has no such section, and never throws', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'c');
    expect(await readFollowUps(dir)).toEqual([]);
  });
});

describe('archive e follow-ups pendentes', () => {
  it('reporta o follow-up sem destino e arquiva mesmo assim', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'com-fu');
    await writeFile(
      path.join(dir, 'design.md'),
      DESIGN('- [ ] FU-1 · follow-up — campos de cliente ficam para uma change de schema')
    );

    const result = await archiveChange(workspace, 'com-fu', {
      now: new Date(2026, 0, 1),
      validate: false,
      force: true,
    });

    expect(result.archivedAs).toBe('2026-01-01-com-fu');
    expect(result.pendingFollowUps).toEqual([
      {
        id: 'FU-1',
        text: 'campos de cliente ficam para uma change de schema',
        dispatched: false,
      },
    ]);
  });
});
