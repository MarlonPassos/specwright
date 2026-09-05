import { describe, expect, it } from 'vitest';
import { archiveChange } from '../../src/core/archive/archive.js';
import { makeWorkspace, seedChange } from '../helpers/workspace.js';
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
