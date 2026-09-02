import { describe, expect, it } from 'vitest';
import { renderProjectDashboard } from '../../src/cli/project-dashboard-view.js';
import { computeProjectStatus } from '../../src/core/project/status.js';
import { recommendNext } from '../../src/core/project/next.js';
import {
  makePlanWorkspace,
  seedPlan,
  seedArchivedChange,
  manifest,
  change,
  withBrief,
} from '../helpers/plan.js';
import { seedChange } from '../helpers/workspace.js';
import type { Workspace } from '../../src/core/workspace.js';

const ANSI = /\u001b\[[0-9;]*m/g;

const link = (name: string) => ({
  name,
  active_path: `spec/changes/${name}`,
  archive_path: null,
  linked_at: '2026-09-01',
});

async function render(workspace: Workspace, color = false): Promise<string> {
  const status = await computeProjectStatus(workspace, 'demo');
  return renderProjectDashboard(status, recommendNext(status), { color, width: 90 });
}

/** A plan with one increment per section the view knows how to draw. */
async function busyPlan(): Promise<Workspace> {
  const workspace = await makePlanWorkspace();
  const done = await withBrief(
    workspace,
    'demo',
    change({ id: 'CH-001', slug: 'fundacao', title: 'Fundação', link: link('fundacao') })
  );
  await seedArchivedChange(workspace, 'fundacao');

  await seedChange(workspace, 'auth', { tasks: '## 1\n- [x] 1.1 feito\n- [ ] 1.2 falta\n' });
  const running = await withBrief(
    workspace,
    'demo',
    change({ id: 'CH-002', slug: 'auth', title: 'Autenticação', depends_on: ['CH-001'], link: link('auth') })
  );

  const ready = await withBrief(
    workspace,
    'demo',
    change({ id: 'CH-003', slug: 'catalogo', title: 'Catálogo', depends_on: ['CH-001'] })
  );
  const blocked = await withBrief(
    workspace,
    'demo',
    change({ id: 'CH-004', slug: 'checkout', title: 'Checkout', depends_on: ['CH-002'] })
  );
  const held = await withBrief(
    workspace,
    'demo',
    change({ id: 'CH-005', slug: 'relatorios', title: 'Relatórios', planning_state: 'on_hold' })
  );

  await seedPlan(
    workspace,
    manifest({
      id: 'demo',
      name: 'Plano de demonstração',
      status: 'active',
      milestones: [
        { id: 'M1', name: 'Base', order: 1, changes: ['CH-001'] },
        { id: 'M2', name: 'Produto', order: 2, changes: ['CH-002', 'CH-003', 'CH-004'] },
      ],
      changes: [
        { ...done, milestone: 'M1' },
        { ...running, milestone: 'M2' },
        { ...ready, milestone: 'M2' },
        { ...blocked, milestone: 'M2' },
        held,
      ],
    })
  );
  return workspace;
}

describe('renderProjectDashboard — estrutura visual', () => {
  it('desenha as mesmas seções ruladas que o painel de status', async () => {
    const out = await render(await busyPlan());
    for (const title of ['RESUMO', 'PRÓXIMO PASSO', 'MILESTONES', 'DIAGNÓSTICOS']) {
      expect(out).toContain(title);
    }
    // The separator rule, not a bare heading.
    expect(out).toMatch(/RESUMO -+/);
  });

  it('agrupa os incrementos por estágio em vez de listar tudo junto', async () => {
    const out = await render(await busyPlan());
    const sections = [
      'EM IMPLEMENTAÇÃO',
      'PRONTAS PARA COMEÇAR',
      'BLOQUEADAS',
      'CONCLUÍDAS',
      'FORA DO FLUXO',
    ];
    for (const section of sections) expect(out, section).toContain(section);
    const order = sections.map((title) => out.indexOf(title));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('cada incremento encabeça uma linha em exatamente uma seção', async () => {
    const out = (await render(await busyPlan())).replace(ANSI, '');
    // Only the grouped listing; the PRÓXIMO PASSO block names an id on purpose.
    const body = out.slice(out.indexOf('EM IMPLEMENTAÇÃO'));
    const rows = body.split('\n').filter((line) => /^.{1,4}(CH-\d{3})\s{2,}/.test(line));
    const ids = rows.map((line) => line.match(/CH-\d{3}/)![0]);
    expect(ids.sort()).toEqual(['CH-001', 'CH-002', 'CH-003', 'CH-004', 'CH-005']);
  });

  it('desenha barra de progresso para tarefas e para o total do plano', async () => {
    const out = (await render(await busyPlan())).replace(ANSI, '');
    expect(out).toMatch(/1\/2\s+50%/); // a checklist do CH-002
    expect(out).toMatch(/[#.]{12} 1\/5/); // incrementos concluídos no resumo
  });

  it('traduz os códigos de razão para português no próximo passo', async () => {
    const out = await render(await busyPlan());
    expect(out).toContain('PRÓXIMO PASSO');
    expect(out).not.toContain('dependencies_satisfied');
    expect(out).toContain('todas as dependências estão concluídas');
  });

  it('mostra o blocker manual em vez de deixar a linha muda', async () => {
    const workspace = await makePlanWorkspace();
    const held = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-001', slug: 'x', title: 'X', manual_blockers: ['imagens não decididas'] })
    );
    await seedPlan(workspace, manifest({ id: 'demo', changes: [held] }));
    expect(await render(workspace)).toContain('blocker: imagens não decididas');
  });

  it('sem cor não emite nenhum escape ANSI', async () => {
    const out = await render(await busyPlan(), false);
    expect(ANSI.test(out)).toBe(false);
  });

  it('com cor emite o wordmark e nunca deixa espaço no fim da linha', async () => {
    const out = await render(await busyPlan(), true);
    expect(out).toContain('\u001b[96m');
    expect(out.split('\n').every((line) => !/\s$/.test(line))).toBe(true);
  });

  it('um plano vazio ainda desenha o painel e diz que não há nada pronto', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'demo', changes: [] }));
    const out = await render(workspace);
    expect(out).toContain('RESUMO');
    expect(out).toContain('Nenhum incremento pronto.');
    expect(out).toContain('nenhum incremento');
  });

  it('um vínculo quebrado cai em COM PROBLEMA e aparece nos diagnósticos', async () => {
    const workspace = await makePlanWorkspace();
    const dangling = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-001', slug: 'gone', title: 'Sumiu', link: link('gone') })
    );
    await seedPlan(workspace, manifest({ id: 'demo', changes: [dangling] }));
    const out = await render(workspace);
    expect(out).toContain('dangling_link');
    expect(out).toContain('COM PROBLEMA');
  });
});
