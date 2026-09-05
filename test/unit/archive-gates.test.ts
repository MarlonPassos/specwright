import { describe, expect, it } from 'vitest';
import { archiveChange } from '../../src/core/archive/archive.js';
import path from 'node:path';
import { makeWorkspace, seedChange, writeFile } from '../helpers/workspace.js';
import { makeGitWorkspace, commitAll } from '../helpers/git.js';

const archived = { now: new Date(2026, 0, 1), validate: false, force: true } as const;

describe('archive avisa quando o trabalho nunca chegou ao git', () => {
  it('avisa sobre a change que o git nunca viu, sem impedir o arquivamento', async () => {
    const workspace = await makeGitWorkspace();
    await seedChange(workspace, 'nunca-commitada');

    const result = await archiveChange(workspace, 'nunca-commitada', archived);

    expect(result.archivedAs).toBe('2026-01-01-nunca-commitada');
    expect(result.unversioned).toBe(true);
  });

  it('cala quando a change já esteve no controle de versão', async () => {
    const workspace = await makeGitWorkspace();
    await seedChange(workspace, 'commitada');
    await commitAll(workspace.projectRoot, 'change');

    // The archive is a rename, so the destination is untracked right after it
    // — always, for every archive. The question that matters is whether the
    // bytes ever reached history at all.
    const result = await archiveChange(workspace, 'commitada', archived);
    expect(result.unversioned).toBeUndefined();
  });

  it('não diz nada, e não falha, fora de um repositório git', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'sem-git');

    const result = await archiveChange(workspace, 'sem-git', archived);
    expect(result.archivedAs).toBe('2026-01-01-sem-git');
    expect(result.unversioned).toBeUndefined();
  });
});

describe('archive e o veredito da verificação', () => {
  const clean =
    '# Verificação — c\n\ndata: 2026-09-05T15:10Z\n\n## Achados em aberto\n\nnenhum\n';

  it('reporta a ausência do veredito e arquiva mesmo assim', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'sem-verify');

    const result = await archiveChange(workspace, 'sem-verify', archived);
    expect(result.verification.present).toBe(false);
    expect(result.archivedAs).toBe('2026-01-01-sem-verify');
  });

  it('recusa sem veredito sob --require-verify', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'sem-verify');

    await expect(
      archiveChange(workspace, 'sem-verify', { ...archived, requireVerify: true })
    ).rejects.toMatchObject({ code: 'verification_missing' });
  });

  it('recusa com achados em aberto sob --require-verify', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'com-achados');
    await writeFile(
      path.join(dir, 'verification.md'),
      '# Verificação — c\n\n## Achados em aberto\n\n- E2E nunca executado\n'
    );

    await expect(
      archiveChange(workspace, 'com-achados', { ...archived, requireVerify: true })
    ).rejects.toMatchObject({ code: 'verification_open_findings' });
  });

  it('aceita um veredito limpo sob --require-verify', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'verificada');
    await writeFile(path.join(dir, 'verification.md'), clean);

    const result = await archiveChange(workspace, 'verificada', {
      ...archived,
      requireVerify: true,
    });
    expect(result.verification.clean).toBe(true);
  });
});
