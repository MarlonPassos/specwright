import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  linkChange,
  unlinkChange,
  adoptChange,
  setPlanningState,
} from '../../src/core/project/link.js';
import { loadPlan } from '../../src/core/project/repository.js';
import { computeProjectStatus } from '../../src/core/project/status.js';
import {
  makePlanWorkspace,
  seedPlan,
  seedArchivedChange,
  manifest,
  change,
} from '../helpers/plan.js';
import { seedChange } from '../helpers/workspace.js';

describe('linkChange', () => {
  it('registers a 1:1 link and bumps revision', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'authentication');
    await seedPlan(
      workspace,
      manifest({ id: 'demo', revision: 2, changes: [change({ id: 'CH-002', slug: 'auth' })] })
    );

    const result = await linkChange(workspace, 'demo', 'CH-002', 'authentication');
    expect(result).toMatchObject({ linked: true, id: 'CH-002', change: 'authentication', revision: 3 });
    expect(result.execution).toBe('proposed'); // seedChange writes an unstarted tasks.md
    expect(result.executionEvidence).toContain('proposal_present');

    const { manifest: reloaded } = await loadPlan(workspace.projectRoot, 'demo');
    expect(reloaded.changes[0].link).toMatchObject({
      name: 'authentication',
      active_path: 'spec/changes/authentication',
      archive_path: null,
    });
  });

  it('refuses a name already used by another increment', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'auth');
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({
            id: 'CH-001',
            slug: 'a',
            link: { name: 'auth', active_path: 'spec/changes/auth', archive_path: null, linked_at: '2026-09-01' },
          }),
          change({ id: 'CH-002', slug: 'b' }),
        ],
      })
    );
    await expect(linkChange(workspace, 'demo', 'CH-002', 'auth')).rejects.toMatchObject({
      code: 'link_already_used',
    });
  });

  it('refuses a target that does not exist and a cancelled increment', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({ id: 'CH-001', slug: 'a' }),
          change({ id: 'CH-002', slug: 'b', planning_state: 'cancelled' }),
        ],
      })
    );
    await expect(linkChange(workspace, 'demo', 'CH-001', 'ghost')).rejects.toMatchObject({
      code: 'link_target_missing',
    });
    await seedChange(workspace, 'b');
    await expect(linkChange(workspace, 'demo', 'CH-002', 'b')).rejects.toMatchObject({
      code: 'invalid_transition',
    });
  });
});

describe('unlinkChange', () => {
  it('removes the link, and needs --force once execution is archived', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'auth');
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({
            id: 'CH-001',
            slug: 'a',
            link: { name: 'auth', active_path: 'spec/changes/auth', archive_path: null, linked_at: '2026-09-01' },
          }),
        ],
      })
    );
    await expect(unlinkChange(workspace, 'demo', 'CH-001')).rejects.toMatchObject({
      code: 'completed_change_protected',
    });
    const result = await unlinkChange(workspace, 'demo', 'CH-001', { force: true });
    expect(result.unlinked).toBe(true);
    const { manifest: reloaded } = await loadPlan(workspace.projectRoot, 'demo');
    expect(reloaded.changes[0].link).toBeNull();
  });
});

describe('adoptChange', () => {
  it('adopts an active change, deriving the title from proposal.md, touching nothing inside it', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'hotfix-auth');
    const metaBefore = await fs.readFile(
      path.join(workspace.changesPath, 'hotfix-auth', '.change.yaml'),
      'utf8'
    );
    await seedPlan(workspace, manifest({ id: 'demo', revision: 4, changes: [] }));

    const result = await adoptChange(workspace, 'demo', 'hotfix-auth');
    expect(result).toMatchObject({ adopted: true, id: 'CH-001', change: 'hotfix-auth', revision: 5 });
    expect(result.title.length).toBeGreaterThan(0);

    const { manifest: reloaded } = await loadPlan(workspace.projectRoot, 'demo');
    expect(reloaded.changes[0].link?.name).toBe('hotfix-auth');
    expect(reloaded.changes[0].planning_state).toBe('planned');
    expect(reloaded.changes[0].planned_change).toBeNull();
    expect(
      await fs.readFile(path.join(workspace.changesPath, 'hotfix-auth', '.change.yaml'), 'utf8')
    ).toBe(metaBefore);
  });

  it('adopts an archive directory and refuses an already-linked name', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'legacy', '2026-08-01');
    await seedPlan(workspace, manifest({ id: 'demo', changes: [] }));

    const first = await adoptChange(workspace, 'demo', '2026-08-01-legacy');
    expect(first.change).toBe('legacy');
    await expect(adoptChange(workspace, 'demo', '2026-08-01-legacy')).rejects.toMatchObject({
      code: 'link_already_used',
    });
  });

  it('refuses a target that is a path instead of a directory name (I-8, NFR-08)', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'demo', changes: [] }));
    for (const target of ['../../../fora', '/etc', 'a/b', '..', 'NaoKebab']) {
      await expect(adoptChange(workspace, 'demo', target)).rejects.toMatchObject({
        code: 'unsafe_plan_path',
      });
    }
    const { manifest: reloaded } = await loadPlan(workspace.projectRoot, 'demo');
    expect(reloaded.changes).toEqual([]);
  });

  it('allocates a fresh id past any cancelled one', async () => {
    const workspace = await makePlanWorkspace();
    await seedChange(workspace, 'x');
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [change({ id: 'CH-007', slug: 'old', planning_state: 'cancelled' })],
      })
    );
    const result = await adoptChange(workspace, 'demo', 'x');
    expect(result.id).toBe('CH-008');
  });
});

describe('setPlanningState', () => {
  it('applies a valid transition and returns the recomputed dimensions', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'x', planning_state: 'idea' })] })
    );
    const result = await setPlanningState(workspace, 'demo', 'CH-001', 'planned');
    expect(result).toMatchObject({ from: 'idea', to: 'planned' });
    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.changes[0].planningState).toBe('planned');
  });

  it('persists the reason on on_hold / cancelled and clears it on return to planned', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'x', planning_state: 'planned' })] })
    );
    await setPlanningState(workspace, 'demo', 'CH-001', 'on_hold', 'aguardando decisão de storage');
    let reloaded = (await loadPlan(workspace.projectRoot, 'demo')).manifest;
    expect(reloaded.changes[0].reason).toBe('aguardando decisão de storage');

    await setPlanningState(workspace, 'demo', 'CH-001', 'planned');
    reloaded = (await loadPlan(workspace.projectRoot, 'demo')).manifest;
    expect(reloaded.changes[0].reason).toBeUndefined();
  });

  it('rejects on_hold without a reason and an out-of-machine transition', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({ id: 'CH-001', slug: 'x', planning_state: 'planned' }),
          change({ id: 'CH-002', slug: 'y', planning_state: 'cancelled' }),
        ],
      })
    );
    await expect(setPlanningState(workspace, 'demo', 'CH-001', 'on_hold')).rejects.toMatchObject({
      code: 'missing_reason',
    });
    await expect(setPlanningState(workspace, 'demo', 'CH-002', 'planned')).rejects.toMatchObject({
      code: 'invalid_transition',
    });
  });
});

describe('linkChange — trabalho já arquivado', () => {
  it('vincula um incremento a uma change que só existe no archive', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'bug-fixes', '2026-09-02');
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'bug-fixes' })] })
    );

    const result = await linkChange(workspace, 'demo', 'CH-001', 'bug-fixes');
    expect(result.linked).toBe(true);
    expect(result.activePath).toBeNull();
    expect(result.archivePath).toBe('spec/changes/archive/2026-09-02-bug-fixes');
    expect(result.execution).toBe('archived');

    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.progress.archived).toBe(1);
    expect(status.progress.percent).toBe(100);
  });

  it('escolhe o archive mais recente quando há mais de um', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'auth', '2026-08-01');
    await seedArchivedChange(workspace, 'auth', '2026-09-02');
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'auth' })] })
    );
    const result = await linkChange(workspace, 'demo', 'CH-001', 'auth');
    expect(result.archivePath).toBe('spec/changes/archive/2026-09-02-auth');
  });

  it('sem diretório ativo nem archive, o erro cita os dois lugares', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'x' })] })
    );
    await expect(linkChange(workspace, 'demo', 'CH-001', 'fantasma')).rejects.toMatchObject({
      code: 'link_target_missing',
      message: expect.stringContaining('archive'),
    });
  });
});

describe('diagnósticos de archive órfão e execução ambígua', () => {
  it('avisa quando uma change arquivada não é reivindicada por nenhum incremento', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'bug-fixes');
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'bug-fixes' })] })
    );
    const status = await computeProjectStatus(workspace, 'demo');
    const found = status.diagnostics.find((d) => d.code === 'unclaimed_archive');
    expect(found).toBeDefined();
    expect(found!.fix).toContain('bug-fixes');
    // É exatamente o vão entre `specs status` (1 arquivada) e o plano (0/1).
    expect(status.progress.archived).toBe(0);
  });

  it('cala quando o incremento reivindica o archive', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'bug-fixes');
    await seedPlan(
      workspace,
      manifest({ id: 'demo', changes: [change({ id: 'CH-001', slug: 'bug-fixes' })] })
    );
    await linkChange(workspace, 'demo', 'CH-001', 'bug-fixes');
    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.diagnostics.some((d) => d.code === 'unclaimed_archive')).toBe(false);
  });

  it('avisa quando um slug tem diretório ativo E archive ao mesmo tempo', async () => {
    const workspace = await makePlanWorkspace();
    await seedArchivedChange(workspace, 'auth');
    await seedChange(workspace, 'auth');
    await seedPlan(
      workspace,
      manifest({
        id: 'demo',
        changes: [
          change({
            id: 'CH-001',
            slug: 'auth',
            link: { name: 'auth', active_path: 'spec/changes/auth', archive_path: null, linked_at: '2026-09-01' },
          }),
        ],
      })
    );
    const status = await computeProjectStatus(workspace, 'demo');
    expect(status.changes[0].execution).toBe('archived');
    const found = status.diagnostics.find((d) => d.code === 'ambiguous_execution');
    expect(found).toBeDefined();
    expect(found!.message).toContain('invisível');
  });
});

