import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readVerification } from '../../src/core/change/verification.js';
import { makeWorkspace, seedChange, writeFile } from '../helpers/workspace.js';

async function withVerdict(body: string): Promise<string> {
  const workspace = await makeWorkspace();
  const dir = await seedChange(workspace, 'c');
  await writeFile(path.join(dir, 'verification.md'), body);
  return dir;
}

describe('readVerification', () => {
  it('reads absence as never-verified, which is not the same as clean', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'c');

    const verdict = await readVerification(dir);
    expect(verdict).toEqual({ present: false, openFindings: [], clean: false });
  });

  it('reads the date and an explicit "nenhum" as clean', async () => {
    const dir = await withVerdict(
      '# Verificação — c\n\ndata: 2026-09-05T15:10Z\n\n## Achados em aberto\n\nnenhum\n'
    );

    expect(await readVerification(dir)).toEqual({
      present: true,
      date: '2026-09-05T15:10Z',
      openFindings: [],
      clean: true,
    });
  });

  it('lists open findings and refuses to call them clean', async () => {
    const dir = await withVerdict(
      '# Verificação — c\n\ndata: 2026-09-05T15:10Z\n\n' +
        '## Achados em aberto\n\n- teste E2E nunca executado\n- TRANSFERRED sem requisito\n'
    );

    const verdict = await readVerification(dir);
    expect(verdict.clean).toBe(false);
    expect(verdict.openFindings).toEqual([
      'teste E2E nunca executado',
      'TRANSFERRED sem requisito',
    ]);
  });

  it('a seção ausente é pergunta não respondida, não atestado de limpeza', async () => {
    const dir = await withVerdict('# Verificação — c\n\ndata: 2026-09-05T15:10Z\n\n## Comandos\n\n- pytest\n');

    const verdict = await readVerification(dir);
    expect(verdict.present).toBe(true);
    expect(verdict.clean).toBe(false);
    expect(verdict.openFindings).toEqual([]);
  });

  it('uma seção vazia também não fecha', async () => {
    const dir = await withVerdict('# Verificação — c\n\n## Achados em aberto\n\n');
    expect((await readVerification(dir)).clean).toBe(false);
  });
});
