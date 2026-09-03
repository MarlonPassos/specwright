import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listDocuments, readDocument } from '../../src/core/documents.js';
import { makeWorkspace, writeFile } from '../helpers/workspace.js';
import type { Workspace } from '../../src/core/workspace.js';

async function withChange(): Promise<Workspace> {
  const workspace = await makeWorkspace();
  const dir = path.join(workspace.changesPath, 'terminal-ux');
  await writeFile(path.join(dir, 'proposal.md'), '## Why\n\nA saída está ilegível.\n');
  await writeFile(path.join(dir, 'design.md'), '## Decisões\n\nUm tema só.\n');
  await writeFile(path.join(dir, 'tasks.md'), '## 1. Base\n\n- [x] 1.1 Tema\n- [ ] 1.2 Cores\n');
  await writeFile(path.join(dir, 'specs', 'painel', 'spec.md'), '## ADDED Requirements\n');
  return workspace;
}

describe('catálogo de documentos', () => {
  it('publica os artefatos de uma change ativa, cada um com sua finalidade', async () => {
    const documents = await listDocuments(await withChange());
    const ids = documents.map((entry) => entry.id);

    expect(ids).toContain('change:terminal-ux:proposal');
    expect(ids).toContain('change:terminal-ux:design');
    expect(ids).toContain('change:terminal-ux:tasks');
    expect(ids).toContain('change:terminal-ux:delta:painel');

    const proposal = documents.find((entry) => entry.id === 'change:terminal-ux:proposal')!;
    expect(proposal.kind).toBe('proposal');
    expect(proposal.group).toBe('Change · terminal-ux');
    expect(proposal.purpose).toBeTruthy();
    expect(proposal.path).toBe('spec/changes/terminal-ux/proposal.md');
  });

  it('não lista o que não existe no disco', async () => {
    const workspace = await makeWorkspace();
    await writeFile(path.join(workspace.changesPath, 'so-proposta', 'proposal.md'), '# x\n');
    const ids = (await listDocuments(workspace)).map((entry) => entry.id);

    expect(ids).toContain('change:so-proposta:proposal');
    expect(ids).not.toContain('change:so-proposta:design');
    expect(ids).not.toContain('change:so-proposta:tasks');
  });

  it('deixa a metadata de máquina de fora — ela é estado, não leitura', async () => {
    const paths = (await listDocuments(await withChange())).map((entry) => entry.path);
    expect(paths.some((entry) => entry.endsWith('config.yaml'))).toBe(false);
    expect(paths.some((entry) => entry.endsWith('.change.yaml'))).toBe(false);
    expect(paths.some((entry) => entry.endsWith('plan.yaml'))).toBe(false);
  });

  it('marca uma change arquivada como tal, num grupo próprio', async () => {
    const workspace = await makeWorkspace();
    await writeFile(
      path.join(workspace.archivePath, '2026-09-01-bug-fixes', 'proposal.md'),
      '## Why\n\nBugs.\n'
    );
    const entry = (await listDocuments(workspace)).find(
      (candidate) => candidate.id === 'archived:2026-09-01-bug-fixes:proposal'
    );

    expect(entry).toBeDefined();
    expect(entry!.archived).toBe(true);
    expect(entry!.group).toContain('Arquivada');
  });

  it('lê um documento pelo id do catálogo', async () => {
    const workspace = await withChange();
    const document = await readDocument(workspace, 'change:terminal-ux:tasks');
    expect(document?.kind).toBe('tasks');
    expect(document?.markdown).toContain('1.2 Cores');
  });

  it('um id fora do catálogo não vira leitura de arquivo (I-8)', async () => {
    const workspace = await withChange();
    for (const id of [
      'change:../../../../etc/passwd:proposal',
      '../../etc/passwd',
      '/etc/passwd',
      'change:terminal-ux:config',
      '',
    ]) {
      expect(await readDocument(workspace, id), id).toBeUndefined();
    }
  });

  it('a capacidade viva entra pelo caminho dela, aninhada inclusive', async () => {
    const workspace = await makeWorkspace();
    await writeFile(
      path.join(workspace.specsPath, 'identity', 'user-auth', 'spec.md'),
      '## Purpose\n\nLogin.\n'
    );
    const entry = (await listDocuments(workspace)).find(
      (candidate) => candidate.id === 'capability:identity/user-auth'
    );
    expect(entry?.kind).toBe('capability');
    expect(entry?.title).toBe('identity/user-auth');
  });
});
