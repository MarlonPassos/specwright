import { describe, expect, it } from 'vitest';
import { loadConfig, renderConfig, type WorkspaceConfig } from '../../src/core/config.js';
import { workspaceAt } from '../../src/core/workspace.js';
import { makeTempDir, writeFile } from '../helpers/workspace.js';

async function roundTrip(config: WorkspaceConfig) {
  const dir = await makeTempDir();
  const workspace = workspaceAt(dir);
  await writeFile(workspace.configPath, renderConfig(config));
  return loadConfig(workspace);
}

describe('renderConfig — todo campo já vem no arquivo, ativo ou comentado com exemplo', () => {
  it('escreve defaultParallel: false explícito quando nada foi configurado', () => {
    const out = renderConfig({ schema: 'spec-driven' });
    expect(out).toContain('defaultParallel: false');
  });

  it('comenta context e rules com um exemplo, em vez de gravá-los vazios', () => {
    const out = renderConfig({ schema: 'spec-driven' });
    expect(out).toContain('# context: ""');
    expect(out).not.toMatch(/^context:/m);
    expect(out).toContain('#   design:');
    expect(out).not.toMatch(/^rules:/m);
  });

  it('escreve context e rules ativos quando de fato configurados, sem os comentários de exemplo', () => {
    const out = renderConfig({ schema: 'spec-driven', context: 'Runs on Node.', rules: { design: ['seja breve'] } });
    expect(out).toMatch(/^context: Runs on Node\.$/m);
    expect(out).toMatch(/^rules:\n {2}design:\n {4}- seja breve$/m);
    expect(out).not.toContain('# context: ""');
  });

  it('faz round-trip sem perder nem inventar valor', async () => {
    const written: WorkspaceConfig = {
      schema: 'spec-driven',
      harnesses: ['claude', 'codex'],
      context: 'Monorepo TypeScript.',
      rules: { proposal: ['citar o ticket'] },
      defaultParallel: true,
      parallelPropose: true,
    };
    const loaded = await roundTrip(written);
    expect(loaded).toEqual(written);
  });

  it('um config minimalista (só schema) carrega de volta com defaultParallel false, não ausente', async () => {
    const loaded = await roundTrip({ schema: 'spec-driven' });
    expect(loaded.defaultParallel).toBe(false);
    expect(loaded.context).toBeUndefined();
    expect(loaded.rules).toBeUndefined();
  });
});
