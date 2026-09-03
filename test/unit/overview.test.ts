import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOverview } from '../../src/core/overview.js';
import { renderOverview } from '../../src/cli/overview-view.js';
import { makePlanWorkspace, seedPlan, manifest, change } from '../helpers/plan.js';
import { seedChange } from '../helpers/workspace.js';

const PLAIN = { color: false, width: 100 };

const linked = (name: string) => ({
  name,
  active_path: `spec/changes/${name}`,
  archive_path: null,
  linked_at: '2026-09-01',
});

describe('buildOverview', () => {
  it('junta a change ativa e o incremento que a reivindica numa entrada só', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'fund-refactor');
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        revision: 3,
        milestones: [{ id: 'M1', name: 'Fundação', order: 1, changes: ['CH-019'] }],
        changes: [
          change({
            id: 'CH-019',
            slug: 'fund-refactor',
            title: 'Refactorings e config de banco',
            milestone: 'M1',
            link: linked('fund-refactor'),
          }),
        ],
      })
    );

    const data = await buildOverview(workspace);

    expect(data.plan).toMatchObject({ id: 'demo', revision: 3 });
    expect(data.focus).toHaveLength(1);
    // A aresta que nenhum dos dois painéis desenhava.
    expect(data.focus[0].change?.id).toBe('fund-refactor');
    expect(data.focus[0].increment).toMatchObject({ id: 'CH-019', milestone: 'M1' });
    expect(data.milestones).toEqual([{ id: 'M1', name: 'Fundação', archived: 0, total: 1 }]);
  });

  it('mostra a change que nenhum incremento reivindica, e o incremento sem change', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'orfa');
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({ id: 'CH-001', slug: 'sumida', title: 'Sumida', link: linked('sumida') }),
        ],
      })
    );

    const data = await buildOverview(workspace);
    const semIncremento = data.focus.find((entry) => entry.change?.id === 'orfa');
    const semChange = data.focus.find((entry) => entry.increment?.id === 'CH-001');

    expect(semIncremento).toBeDefined();
    expect(semIncremento!.increment).toBeUndefined();
    // O vínculo aponta um diretório que não existe: execução `unknown`, e o
    // incremento não é reportado como em andamento.
    expect(semChange).toBeUndefined();
  });

  it('projeta só a execução num projeto sem planning/', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'solo');

    const data = await buildOverview(workspace);

    expect(data.plan).toBeUndefined();
    expect(data.increments).toBeUndefined();
    expect(data.milestones).toBeUndefined();
    expect(data.focus).toEqual([expect.objectContaining({ change: expect.objectContaining({ id: 'solo' }) })]);
  });

  it('degrada para o lado da execução quando o plano não carrega', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'solo');
    await seedPlan(workspace, manifest({ id: 'demo', changes: [] }));
    await fs.writeFile(path.join(workspace.projectRoot, 'planning/demo/plan.yaml'), ':\n - [ quebrado', 'utf8');

    const data = await buildOverview(workspace);

    // Meia tela quebrada é pior que meia tela: o lado que funciona continua.
    expect(data.plan).toBeUndefined();
    expect(data.changes.active).toBe(1);
  });
});

describe('renderOverview', () => {
  it('desenha o par change ↔ incremento no bloco FOCO AGORA', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'fund-refactor');
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({
            id: 'CH-019',
            slug: 'fund-refactor',
            title: 'Refactorings e config de banco',
            link: linked('fund-refactor'),
          }),
        ],
      })
    );

    const text = renderOverview(await buildOverview(workspace), PLAIN);

    expect(text).toContain('FOCO AGORA');
    expect(text).toContain('fund-refactor');
    expect(text).toContain('CH-019');
    expect(text).not.toContain('['); // sem cor pedida, sem escape emitido
  });

  it('num projeto sem plano não desenha nenhuma seção de plano', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'solo');

    const text = renderOverview(await buildOverview(workspace), PLAIN);

    expect(text).toContain('EXECUÇÃO');
    expect(text).not.toContain('MILESTONES');
    expect(text).not.toContain('Status do plano');
  });

  it('empilha as colunas numa janela estreita em vez de espremê-las', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'a' })] })
    );
    const data = await buildOverview(workspace);

    const largo = renderOverview(data, { color: false, width: 120 });
    const estreito = renderOverview(data, { color: false, width: 60 });

    // Largo: os dois títulos na mesma linha. Estreito: um por linha.
    expect(largo.split('\n').some((line) => line.includes('EXECUÇÃO') && line.includes('PLANO'))).toBe(true);
    expect(estreito.split('\n').some((line) => line.includes('EXECUÇÃO') && line.includes('PLANO'))).toBe(false);
    expect(estreito).toContain('PLANO');
  });
});
