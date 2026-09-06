import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { watchProject } from '../../src/server/watcher.js';
import { makeTempDir } from '../helpers/workspace.js';

/**
 * Espera uma janela de debounce fechar, mais folga para o SO.
 *
 * Correto apenas para afirmar que NADA aconteceu: aí é preciso esperar um tempo
 * e então conferir. Para afirmar que algo aconteceu, use `until` — um sono fixo
 * ali é uma aposta na latência do `fs.watch`, que varia com a carga da máquina.
 */
const settle = (ms = 220): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Espera a condição virar verdadeira, ou falha com o que ela viu por último.
 *
 * O `fs.watch` não promete latência: no macOS ele passa por FSEvents, e o mesmo
 * evento que chega em 20 ms com a máquina ociosa pode levar muito mais com a
 * suíte inteira martelando o disco em paralelo. Esperar um valor fixo e então
 * afirmar transforma essa variação em teste intermitente — que foi o que
 * aconteceu aqui, falhando na suíte completa e passando sozinho.
 *
 * Consultar a condição remove a aposta e ainda deixa o caso comum mais rápido:
 * volta assim que o evento chega, em vez de dormir o pior caso sempre.
 */
async function until(
  condition: () => boolean,
  describe: () => string,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`condição não foi satisfeita em ${timeoutMs}ms: ${describe()}`);
}

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

    // Duas afirmações distintas: o aviso CHEGA, e vem um só. A primeira espera
    // a condição; a segunda precisa mesmo de um sono, porque afirma ausência.
    await until(() => hits >= 1, () => `hits=${hits}`);
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

describe('watchProject — diretório que ainda não existe', () => {
  it('avisa quando o diretório ausente NASCE, e passa a observá-lo', async () => {
    const root = await makeTempDir('watch-');
    const planning = path.join(root, 'planning');
    let hits = 0;
    const watcher = watchProject({
      directories: [planning],
      onChange: () => (hits += 1),
      debounceMs: 60,
    });

    // O painel sobe num projeto sem plano: não há o que observar ainda.
    expect(watcher.watching).toEqual([]);

    // Criar o plano é justamente a mudança que o leitor quer ver.
    await fs.mkdir(path.join(planning, 'demo'), { recursive: true });
    await until(() => hits >= 1, () => `hits=${hits}`);
    expect(watcher.watching).toEqual([planning]);

    // E, dali em diante, o conteúdo dele conta como mudança.
    const before = hits;
    await fs.writeFile(path.join(planning, 'demo', 'plan.yaml'), 'id: demo\n');
    await until(() => hits > before, () => `hits=${hits}, antes=${before}`);

    watcher.close();
  });

  it('a sentinela do pai é solta assim que não há mais diretório ausente', async () => {
    const root = await makeTempDir('watch-');
    const present = path.join(root, 'spec');
    await fs.mkdir(present, { recursive: true });

    const watcher = watchProject({ directories: [present], onChange: () => {}, debounceMs: 60 });
    expect(watcher.watching).toEqual([present]);
    watcher.close();
  });

  it('close encerra tudo, inclusive o que só espera um diretório aparecer', async () => {
    const root = await makeTempDir('watch-');
    let hits = 0;
    const watcher = watchProject({
      directories: [path.join(root, 'planning')],
      onChange: () => (hits += 1),
      debounceMs: 60,
    });
    watcher.close();

    await fs.mkdir(path.join(root, 'planning'), { recursive: true });
    await settle(400);
    expect(hits).toBe(0);
  });
});
