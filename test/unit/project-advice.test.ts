import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adviseLink } from '../../src/core/project/advice.js';
import { makePlanWorkspace, seedPlan, manifest, change } from '../helpers/plan.js';

describe('adviseLink', () => {
  it('aponta o incremento sem vínculo que planeja aquele slug', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [change({ id: 'CH-018', slug: 'fund-empacotamento', title: 'Empacotamento' })],
      })
    );

    await expect(adviseLink(workspace.projectRoot, 'fund-empacotamento')).resolves.toEqual({
      plan: 'demo',
      change: 'CH-018',
      slug: 'fund-empacotamento',
      title: 'Empacotamento',
      fix: 'specs project link CH-018 fund-empacotamento',
    });
  });

  it('cala para um incremento já vinculado, um cancelado e um slug que ninguém planeja', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({
            id: 'CH-001',
            slug: 'ja-vinculado',
            link: {
              name: 'ja-vinculado',
              active_path: 'spec/changes/ja-vinculado',
              archive_path: null,
              linked_at: '2026-09-01',
            },
          }),
          change({ id: 'CH-002', slug: 'cancelado', planning_state: 'cancelled' }),
        ],
      })
    );

    for (const name of ['ja-vinculado', 'cancelado', 'nada-a-ver']) {
      await expect(adviseLink(workspace.projectRoot, name)).resolves.toBeUndefined();
    }
  });

  it('nomeia o plano no comando quando há mais de um', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'alpha', changes: [] }));
    await seedPlan(
      workspace,
      manifest({ id: 'beta', changes: [change({ id: 'CH-003', slug: 'auth' })] })
    );

    // `specs project link` recebe o plan-id como primeiro posicional opcional;
    // com dois planos ele deixa de ser opcional.
    await expect(adviseLink(workspace.projectRoot, 'auth')).resolves.toMatchObject({
      plan: 'beta',
      fix: 'specs project link beta CH-003 auth',
    });
  });

  it('cala sem área de planejamento e com um plano que não carrega', async () => {
    const semPlano = await makePlanWorkspace();
    await expect(adviseLink(semPlano.projectRoot, 'qualquer')).resolves.toBeUndefined();

    const corrompido = await makePlanWorkspace();
    await seedPlan(corrompido, manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'auth' })] }));
    await fs.writeFile(
      path.join(corrompido.projectRoot, 'planning/demo/plan.yaml'),
      ':\n  - [ quebrado',
      'utf8'
    );

    // Um plano quebrado não pode mudar o que um comando de workspace faz (AC-51).
    await expect(adviseLink(corrompido.projectRoot, 'auth')).resolves.toBeUndefined();
  });
});
