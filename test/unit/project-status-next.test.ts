import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeProjectStatus, statusPayload } from '../../src/core/project/status.js';
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

const link = (name: string) => ({
  name,
  active_path: `spec/changes/${name}`,
  archive_path: null,
  linked_at: '2026-09-01',
});

describe('computeProjectStatus — three dimensions', () => {
  it('marks CH-002 ready once CH-001 is archived and its brief is current (AC-22)', async () => {
    const workspace = await makePlanWorkspace();
    const ch1 = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-001', slug: 'foundation', title: 'Fundação', link: link('foundation') })
    );
    const ch2 = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-002', slug: 'authentication', title: 'Auth', depends_on: ['CH-001'], link: link('authentication') })
    );
    await seedPlan(workspace, manifest({ id: 'demo', changes: [ch1, ch2] }));
    await seedArchivedChange(workspace, 'foundation');

    const before = await fs.readFile(
      path.join(workspace.projectRoot, 'planning/demo/plan.yaml'),
      'utf8'
    );
    const status = await computeProjectStatus(workspace, 'demo');
    const after = await fs.readFile(
      path.join(workspace.projectRoot, 'planning/demo/plan.yaml'),
      'utf8'
    );
    expect(after).toBe(before); // nothing derived is persisted

    const ch2view = status.changes.find((c) => c.id === 'CH-002')!;
    expect(ch2view.readiness).toBe('ready');
    expect(ch2view.readinessReasons).toEqual(['dependencies_satisfied', 'planned_change_current']);
    expect(status.changes.find((c) => c.id === 'CH-001')!.execution).toBe('archived');
  });

  it('a manual blocker blocks even with deps archived and keeps it out of parallelReady (AC-23)', async () => {
    const workspace = await makePlanWorkspace();
    const ch1 = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-001', slug: 'foundation', link: link('foundation') })
    );
    const ch3 = await withBrief(
      workspace,
      'demo',
      change({
        id: 'CH-003',
        slug: 'catalog',
        depends_on: ['CH-001'],
        manual_blockers: ['imagens não decididas'],
      })
    );
    await seedPlan(workspace, manifest({ id: 'demo', changes: [ch1, ch3] }));
    await seedArchivedChange(workspace, 'foundation');

    const status = await computeProjectStatus(workspace, 'demo');
    const view = status.changes.find((c) => c.id === 'CH-003')!;
    expect(view.readiness).toBe('blocked');
    expect(view.readinessReasons).toContain('manual_blocker_present');
    expect(view.blockedBy).toEqual([]);
    expect(view.manualBlockers).toEqual(['imagens não decididas']);

    const next = recommendNext(status);
    expect(next.parallelReady).not.toContain('CH-003');
  });

  it('an idea is not_applicable and never recommended (AC-24)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'x', planning_state: 'idea' })] })
    );
    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.changes[0].readiness).toBe('not_applicable');
    expect(status.changes[0].readinessReasons).toContain('state_not_eligible');
    expect(recommendNext(status).recommended).toBeNull();
  });

  it('reads task progress as in_progress / verifying (AC-25, AC-26)', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'auth', {
      tasks: '## 1\n- [x] 1.1 done\n- [ ] 1.2 todo\n',
    });
    const ch = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-001', slug: 'auth', link: link('auth') })
    );
    await seedPlan(workspace, manifest({ id: 'demo', changes: [ch] }));

    let status = await computeProjectStatus(workspace, 'demo');
    expect(status.changes[0].execution).toBe('in_progress');
    expect(status.changes[0].executionEvidence).toContain('tasks_started');

    await fs.writeFile(
      path.join(workspace.changesPath, 'auth', 'tasks.md'),
      '## 1\n- [x] 1.1 done\n- [x] 1.2 also\n'
    );
    status = await computeProjectStatus(workspace, 'demo');
    expect(status.changes[0].execution).toBe('verifying');
  });

  it('a dangling link is inconsistente, never concluída (AC-41)', async () => {
    const workspace = await makePlanWorkspace();
    const ch = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-001', slug: 'gone', link: link('gone') })
    );
    await seedPlan(workspace, manifest({ id: 'demo', changes: [ch] }));

    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.changes[0].execution).toBe('unknown');
    expect(status.changes[0].presentation).toBe('inconsistente');
    expect(status.diagnostics.some((d) => d.code === 'dangling_link')).toBe(true);
  });

  it('derivedStatus becomes completed then active when an increment is added (AC-32)', async () => {
    const workspace = await makePlanWorkspace();
    const ch1 = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-001', slug: 'foundation', link: link('foundation') })
    );
    await seedArchivedChange(workspace, 'foundation');
    await seedPlan(workspace, manifest({ id: 'demo', status: 'active', changes: [ch1] }));

    let status = await computeProjectStatus(workspace, 'demo');
    expect(status.plan.derivedStatus).toBe('completed');

    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        status: 'active',
        changes: [ch1, change({ id: 'CH-002', slug: 'next-thing' })],
      })
    );
    status = await computeProjectStatus(workspace, 'demo');
    expect(status.plan.derivedStatus).toBe('active');
  });

  it('reports stale_plan_status when declared and derived diverge (AC-33)', async () => {
    const workspace = await makePlanWorkspace();
    const ch = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-001', slug: 'x', link: link('x') })
    );
    await seedArchivedChange(workspace, 'x');
    await seedPlan(workspace, manifest({ id: 'demo', status: 'draft', changes: [ch] }));

    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.plan.status).toBe('draft');
    expect(status.plan.derivedStatus).not.toBe('draft');
    expect(status.diagnostics.some((d) => d.code === 'stale_plan_status')).toBe(true);
  });

  it('the JSON payload uses camelCase and omits the internal graph', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'x' })] }));
    const payload = statusPayload(await computeProjectStatus(workspace, 'demo'));
    expect(payload).not.toHaveProperty('graph');
    expect(payload).not.toHaveProperty('manifest');
    expect((payload.changes as any[])[0]).toHaveProperty('planningState');
  });
});

describe('recommendNext — ranking', () => {
  it('is deterministic across repeated calls (AC-29)', async () => {
    const workspace = await makePlanWorkspace();
    const changes = await Promise.all(
      ['a', 'b', 'c'].map((slug, i) =>
        withBrief(workspace, 'demo', change({ id: `CH-00${i + 1}`, slug, priority: 'high' }))
      )
    );
    await seedPlan(workspace, manifest({ id: 'demo', changes }));
    const status = await computeProjectStatus(workspace, 'demo');

    const runs = [recommendNext(status), recommendNext(status), recommendNext(status)];
    const json = runs.map((r) => JSON.stringify(r));
    expect(new Set(json).size).toBe(1);
  });

  it('with nothing ready, recommended is null and every change is excluded (AC-30)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({ id: 'CH-001', slug: 'a', planning_state: 'idea' }),
          change({ id: 'CH-002', slug: 'b', manual_blockers: ['x'] }),
        ],
      })
    );
    const next = recommendNext(await computeProjectStatus(workspace, 'demo'));
    expect(next.recommended).toBeNull();
    expect(next.excluded.map((e) => e.id).sort()).toEqual(['CH-001', 'CH-002']);
  });

  it('carries the parallel caveat and no critical-path field (AC-31)', async () => {
    const workspace = await makePlanWorkspace();
    const ch = await withBrief(workspace, 'demo', change({ id: 'CH-001', slug: 'x' }));
    await seedPlan(workspace, manifest({ id: 'demo', changes: [ch] }));
    const next = recommendNext(await computeProjectStatus(workspace, 'demo'));
    expect(next.parallelCaveat).toMatch(/conflito de código/);
    expect(JSON.stringify(next)).not.toMatch(/critical.?path|caminhoCritico/i);
  });
});

describe('progress — conta trabalho pendente, não entregue', () => {
  it('reproduz o cenário de archive de §8: archived=2, ready=1', async () => {
    const workspace = await makePlanWorkspace();
    // CH-001 e CH-002 concluídos; CH-004 dependia de CH-002 e acabou de liberar.
    const ch1 = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-001', slug: 'foundation', link: link('foundation') })
    );
    const ch2 = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-002', slug: 'authentication', depends_on: ['CH-001'], link: link('authentication') })
    );
    const ch4 = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-004', slug: 'checkout', depends_on: ['CH-002'] })
    );
    await seedPlan(workspace, manifest({ id: 'demo', changes: [ch1, ch2, ch4] }));
    await seedArchivedChange(workspace, 'foundation');
    await seedArchivedChange(workspace, 'authentication');

    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.progress.archived).toBe(2);
    expect(status.progress.ready).toBe(1);

    // Os arquivados seguem com readiness ready por incremento (§7.6, cenário D).
    expect(status.changes.find((c) => c.id === 'CH-002')!.readiness).toBe('ready');
    expect(status.changes.find((c) => c.id === 'CH-002')!.execution).toBe('archived');
  });

  it('progress.ready nunca discorda de next.parallelReady', async () => {
    const workspace = await makePlanWorkspace();
    const done = await withBrief(
      workspace,
      'demo',
      change({ id: 'CH-001', slug: 'done', link: link('done') })
    );
    const open = await withBrief(workspace, 'demo', change({ id: 'CH-002', slug: 'open' }));
    await seedPlan(workspace, manifest({ id: 'demo', changes: [done, open] }));
    await seedArchivedChange(workspace, 'done');

    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.progress.ready).toBe(recommendNext(status).parallelReady.length);
  });

  it('um incremento arquivado com brief quebrado não infla progress.blocked', async () => {
    const workspace = await makePlanWorkspace();
    const broken = change({
      id: 'CH-001',
      slug: 'gone',
      link: link('gone'),
      planned_change: {
        path: 'planned-changes/CH-001-gone.md',
        generated_from_plan_revision: 0,
        source_hash: 'x',
        content_hash: 'y',
      },
    });
    await seedPlan(workspace, manifest({ id: 'demo', changes: [broken] }));
    await seedArchivedChange(workspace, 'gone');

    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.changes[0].execution).toBe('archived');
    expect(status.progress.blocked).toBe(0);
    expect(status.progress.archived).toBe(1);
  });
});

