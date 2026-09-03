import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { watchProject } from '../../src/server/watcher.js';
import { makeTempDir } from '../helpers/workspace.js';

/** Waits long enough for a debounce window to close, plus slack for the OS. */
const settle = (ms = 220): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('watchProject', () => {
  it('colapsa a rajada de uma escrita atômica em UM aviso', async () => {
    const dir = await makeTempDir('watch-');
    let hits = 0;
    const watcher = watchProject({
      directories: [dir],
      onChange: () => (hits += 1),
      debounceMs: 60,
    });

    // O que writeFileAtomic faz: grava temporário, renomeia por cima.
    const temporary = path.join(dir, '.plan.yaml.123.abc.tmp');
    await fs.writeFile(temporary, 'a');
    await fs.rename(temporary, path.join(dir, 'plan.yaml'));
    await fs.writeFile(path.join(dir, 'plan.yaml'), 'b');
    await settle();

    expect(hits).toBe(1);
    watcher.close();
  });

  it('ignora o temporário e o lock, que não são estado observável', async () => {
    const dir = await makeTempDir('watch-');
    let hits = 0;
    const watcher = watchProject({ directories: [dir], onChange: () => (hits += 1), debounceMs: 60 });

    await fs.writeFile(path.join(dir, 'algo.tmp'), 'x');
    await fs.writeFile(path.join(dir, '.plan.lock'), 'x');
    await fs.writeFile(path.join(dir, '.DS_Store'), 'x');
    await settle();

    expect(hits).toBe(0);
    watcher.close();
  });

  it('um diretório ausente é pulado, não derruba o watcher', async () => {
    const dir = await makeTempDir('watch-');
    const watcher = watchProject({
      directories: [dir, path.join(dir, 'nao-existe')],
      onChange: () => undefined,
      debounceMs: 60,
    });
    expect(watcher.watching).toEqual([dir]);
    watcher.close();
  });

  it('depois de close, nenhum aviso chega', async () => {
    const dir = await makeTempDir('watch-');
    let hits = 0;
    const watcher = watchProject({ directories: [dir], onChange: () => (hits += 1), debounceMs: 60 });

    await fs.writeFile(path.join(dir, 'a.yaml'), 'x');
    watcher.close();
    await settle();

    expect(hits).toBe(0);
  });
});
