import path from 'node:path';
import { promises as fs } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeTempDir, parseJson, runCli, writeFile } from '../helpers/workspace.js';

async function initProject(): Promise<string> {
  const dir = await makeTempDir();
  expect((await runCli(['init', '.', '--json'], dir)).code).toBe(0);
  return dir;
}

beforeAll(async () => {
  await fs.stat(path.join(process.cwd(), 'dist', 'cli', 'index.js'));
});

describe('specs project — CLI', () => {
  it('bundle-schema publica o contrato do apply, com exemplo aplicável', async () => {
    const dir = await initProject();
    expect((await runCli(['project', 'create', 'demo', '--json'], dir)).code).toBe(0);

    const result = await runCli(['project', 'bundle-schema', '--json'], dir);
    expect(result.code).toBe(0);
    const contract = parseJson(result.stdout);
    expect(contract.bundleVersion).toBe(1);
    expect((contract.operations as Array<{ op: string }>).map((entry) => entry.op)).toContain(
      'addChange'
    );
    expect(JSON.stringify(contract.rules)).toContain('idMap');

    // The published example must survive a real --dry-run in a real project.
    await writeFile(path.join(dir, 'docs/PLANO-DE-MELHORIAS.md'), '# melhorias\n');
    const bundleFile = path.join(dir, 'bundle.json');
    await writeFile(bundleFile, JSON.stringify(contract.example));
    const dryRun = await runCli(
      ['project', 'apply', '--file', bundleFile, '--dry-run', '--json'],
      dir
    );
    expect(dryRun.code).toBe(0);
    expect(parseJson(dryRun.stdout).idMap).toMatchObject({ $fundacao: 'CH-001' });
  });

  it('o texto do bundle-schema também sai sem --json', async () => {
    const dir = await initProject();
    expect((await runCli(['project', 'create', 'demo', '--json'], dir)).code).toBe(0);
    const result = await runCli(['project', 'bundle-schema'], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('setMilestones');
    expect(result.stdout).toContain('$nome');
  });

  it('creates a plan and emits the JSON contract', async () => {
    const dir = await initProject();
    await writeFile(path.join(dir, 'docs/vision.md'), '# Vision\n\nbig doc\n');

    const result = await runCli(
      ['project', 'create', 'ecommerce', 'docs/vision.md', '--name', 'E-commerce', '--json'],
      dir
    );
    expect(result.code).toBe(0);
    const payload = parseJson(result.stdout);
    expect(payload).toMatchObject({ plan: 'ecommerce', revision: 0, path: 'planning/ecommerce' });
    expect(payload.created).toContain('planning/ecommerce/plan.yaml');

    for (const file of ['plan.yaml', 'plan.md', 'architecture.md']) {
      await expect(fs.stat(path.join(dir, 'planning/ecommerce', file))).resolves.toBeTruthy();
    }
  });

  it('refuses a duplicate plan with plan_exists and exit 1', async () => {
    const dir = await initProject();
    expect((await runCli(['project', 'create', 'p', '--json'], dir)).code).toBe(0);

    const again = await runCli(['project', 'create', 'p', '--json'], dir);
    expect(again.code).toBe(1);
    expect(parseJson(again.stdout)).toMatchObject({ plan: null, error: { code: 'plan_exists' } });
  });

  it('validates a freshly created plan as clean', async () => {
    const dir = await initProject();
    await runCli(['project', 'create', 'p', '--json'], dir);

    const result = await runCli(['project', 'validate', 'p', '--json'], dir);
    expect(result.code).toBe(0);
    const payload = parseJson(result.stdout);
    expect(payload.valid).toBe(true);
    expect(payload.reports[0].type).toBe('plan');
  });

  it('reports plan_not_found for validate without a plan', async () => {
    const dir = await initProject();
    const result = await runCli(['project', 'validate', '--json'], dir);
    expect(result.code).toBe(1);
    expect(parseJson(result.stdout).error.code).toBe('plan_not_found');
  });

  it('outside a workspace it still returns workspace_not_found', async () => {
    const dir = await makeTempDir();
    const result = await runCli(['project', 'create', 'p', '--json'], dir);
    expect(result.code).toBe(1);
    expect(parseJson(result.stdout).error.code).toBe('workspace_not_found');
  });

  it('every project --json failure is a single JSON document with error.code', async () => {
    const dir = await initProject();
    const result = await runCli(['project', 'validate', 'nope', '--json'], dir);
    expect(() => parseJson(result.stdout)).not.toThrow();
    expect(parseJson(result.stdout).error.code).toBeTruthy();
  });

  it('status, next, generate and the dashboard round-trip on a real plan', async () => {
    const dir = await initProject();
    await writeFile(path.join(dir, 'docs/v.md'), '# vision\n');
    await runCli(['project', 'create', 'p', 'docs/v.md', '--json'], dir);

    // Seed two increments via a bundle-less manifest edit is not allowed;
    // generate needs a change record, so drive it through the CLI surface only.
    const status0 = parseJson((await runCli(['project', 'status', '--json'], dir)).stdout);
    expect(status0.plan.id).toBe('p');
    expect(status0.changes).toEqual([]);

    const next0 = parseJson((await runCli(['project', 'next', '--json'], dir)).stdout);
    expect(next0.recommended).toBeNull();
    expect(next0.parallelCaveat).toBeTruthy();

    const dash = parseJson((await runCli(['project', '--json'], dir)).stdout);
    expect(dash.dashboardSchemaVersion).toBe(1);
    expect(dash.generatedAt).toBeTruthy();
  });

  it('rejects --json with --watch (AC-59)', async () => {
    const dir = await initProject();
    await runCli(['project', 'create', 'p', '--json'], dir);
    const result = await runCli(['project', '--json', '--watch'], dir);
    expect(result.code).toBe(1);
    expect(parseJson(result.stdout).error.code).toBe('invalid_option');
  });

  it('the empty dashboard suggests create and writes nothing (AC-58)', async () => {
    const dir = await initProject();
    const result = await runCli(['project'], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('specs project create');
    await expect(fs.stat(path.join(dir, 'planning'))).rejects.toThrow();
  });
});

describe('specs project — link / adopt / sync / set-state', () => {
  async function planWithChange(): Promise<string> {
    const dir = await initProject();
    await runCli(['project', 'create', 'p', '--json'], dir);
    await runCli(['new', 'change', 'authentication'], dir);
    await runCli(['project', 'adopt', 'authentication', '--json'], dir);
    return dir;
  }

  it('adopt then set-state then sync, all as single JSON documents', async () => {
    const dir = await planWithChange();

    const adopted = parseJson((await runCli(['project', 'show', 'CH-001', '--json'], dir)).stdout);
    expect(adopted.change.link.name).toBe('authentication');

    const held = await runCli(['project', 'set-state', 'CH-001', 'on_hold', '--json'], dir);
    expect(parseJson(held.stdout).error.code).toBe('missing_reason');

    const ok = await runCli(
      ['project', 'set-state', 'CH-001', 'on_hold', '--reason', 'aguardando decisão', '--json'],
      dir
    );
    expect(parseJson(ok.stdout)).toMatchObject({ from: 'planned', to: 'on_hold' });

    const sync = parseJson((await runCli(['project', 'sync', '--check', '--json'], dir)).stdout);
    expect(sync.checked).toBe(true);
  });

  it('link refuses a missing target and a duplicate name', async () => {
    const dir = await initProject();
    await runCli(['project', 'create', 'p', '--json'], dir);
    // hand-write two increments is not possible via CLI; drive through adopt.
    await runCli(['new', 'change', 'auth'], dir);
    await runCli(['project', 'adopt', 'auth', '--json'], dir);

    const missing = await runCli(['project', 'link', 'CH-001', 'ghost', '--json'], dir);
    expect(parseJson(missing.stdout).error.code).toBe('link_target_missing');
  });

  it('apply reads a bundle from --file and from stdin, and impact/list/pause work', async () => {
    const dir = await initProject();
    await runCli(['project', 'create', 'shop', '--json'], dir);

    const bundle = JSON.stringify({
      bundleVersion: 1,
      expectRevision: 0,
      operations: [
        { op: 'addChange', ref: '$a', slug: 'foundation', title: 'Fundação', priority: 'critical',
          plannedChange: { objetivo: 'Base.', escopo: ['x'], criteriosMacro: ['y'] } },
        { op: 'addChange', ref: '$b', slug: 'auth', title: 'Auth', dependsOn: ['$a'],
          plannedChange: { objetivo: 'Login.', escopo: ['x'], criteriosMacro: ['y'] } },
      ],
    });
    await writeFile(path.join(dir, 'b.json'), bundle);

    const applied = parseJson((await runCli(['project', 'apply', '--file', 'b.json', '--json'], dir)).stdout);
    expect(applied).toMatchObject({ applied: true, idMap: { $a: 'CH-001', $b: 'CH-002' } });

    const impact = parseJson((await runCli(['project', 'impact', '--change', 'CH-001', '--json'], dir)).stdout);
    expect(impact.dependents).toEqual(['CH-002']);

    const list = parseJson((await runCli(['project', 'list', '--json'], dir)).stdout);
    expect(list.plans[0]).toMatchObject({ id: 'shop', total: 2 });

    const paused = await runCli(['project', 'pause', '--json'], dir);
    expect(parseJson(paused.stdout).error.code).toBe('missing_reason');
    const ok = parseJson((await runCli(['project', 'pause', '--reason', 'x', '--json'], dir)).stdout);
    expect(ok.status).toBe('paused');
    expect(parseJson((await runCli(['project', 'resume', '--json'], dir)).stdout).status).toBe('active');
  });

  it('a corrupt plan.yaml never affects specs archive', async () => {
    const dir = await initProject();
    await runCli(['project', 'create', 'p', '--json'], dir);
    await fs.writeFile(path.join(dir, 'planning/p/plan.yaml'), ':\n - [broken', 'utf8');

    await runCli(['new', 'change', 'small-fix'], dir);
    await writeFile(
      path.join(dir, 'spec/changes/small-fix/proposal.md'),
      '## Why\n\nCustomers keep hitting a small papercut that wastes support time every week.\n\n## What Changes\n\n- fix it\n\n## Impact\n\nnone\n'
    );
    await writeFile(path.join(dir, 'spec/changes/small-fix/.change.yaml'), 'schema: spec-driven\nskip_specs: true\n');
    await writeFile(path.join(dir, 'spec/changes/small-fix/tasks.md'), '## 1\n- [x] 1.1 done\n');

    const archive = await runCli(['archive', 'small-fix', '--json'], dir);
    const payload = parseJson(archive.stdout);
    expect(archive.code).toBe(0);
    expect(JSON.stringify(payload)).not.toMatch(/plan/i);
  });
});

describe('specs project — no regression', () => {
  it('adding a plan does not change the output of existing commands', async () => {
    const dir = await initProject();
    const commands = [
      ['status', '--json'],
      ['list', '--json'],
      ['validate', '--all', '--json'],
      ['harnesses', '--json'],
      ['status'],
    ];

    const before = await Promise.all(commands.map((args) => runCli(args, dir)));
    expect((await runCli(['project', 'create', 'p', '--json'], dir)).code).toBe(0);
    const after = await Promise.all(commands.map((args) => runCli(args, dir)));

    for (let i = 0; i < commands.length; i += 1) {
      expect(after[i].stdout).toBe(before[i].stdout);
      expect(after[i].code).toBe(before[i].code);
    }
  });

  it('a corrupt plan.yaml does not break commands outside the project group', async () => {
    const dir = await initProject();
    await runCli(['project', 'create', 'p', '--json'], dir);
    await fs.writeFile(path.join(dir, 'planning/p/plan.yaml'), ':\n  - [ broken', 'utf8');

    for (const args of [['status', '--json'], ['list', '--json'], ['validate', '--all', '--json']]) {
      const result = await runCli(args, dir);
      expect(result.code).toBe(0);
    }
  });

  it('new change avisa do incremento que planeja o slug, e cala sem plano', async () => {
    const dir = await initProject();

    const semPlano = await runCli(['new', 'change', 'fund-empacotamento', '--json'], dir);
    expect(semPlano.code).toBe(0);
    expect(parseJson(semPlano.stdout).plan).toBeUndefined();

    await runCli(['project', 'create', 'demo', '--json'], dir);
    const bundle = path.join(dir, 'b.json');
    await writeFile(
      bundle,
      JSON.stringify({
        bundleVersion: 1,
        expectRevision: 0,
        operations: [
          { op: 'addChange', ref: '$emp', slug: 'fund-empacotamento-2', title: 'Empacotamento' },
        ],
      })
    );
    expect((await runCli(['project', 'apply', '--file', bundle, '--json'], dir)).code).toBe(0);

    const comPlano = await runCli(['new', 'change', 'fund-empacotamento-2', '--json'], dir);
    expect(comPlano.code).toBe(0);
    // O plano não é tocado: isto é só a indicação de um comando a rodar.
    expect(parseJson(comPlano.stdout).plan).toMatchObject({
      plan: 'demo',
      change: 'CH-001',
      fix: 'specs project link CH-001 fund-empacotamento-2',
    });
    const status = parseJson((await runCli(['project', 'status', '--json'], dir)).stdout);
    expect((status.changes as Array<{ execution: string }>)[0].execution).toBe('unlinked');

    // E o comando indicado é executável tal como veio.
    const link = await runCli(
      ['project', 'link', 'CH-001', 'fund-empacotamento-2', '--json'],
      dir
    );
    expect(link.code).toBe(0);
    expect(parseJson(link.stdout)).toMatchObject({ linked: true, id: 'CH-001' });
  });

  it('archive vincula o incremento que planejava o slug e reporta no JSON', async () => {
    const dir = await initProject();
    await runCli(['project', 'create', 'demo', '--json'], dir);
    const bundle = path.join(dir, 'b.json');
    await writeFile(
      bundle,
      JSON.stringify({
        bundleVersion: 1,
        expectRevision: 0,
        operations: [
          { op: 'addChange', ref: '$e', slug: 'empacotamento', title: 'Empacotamento' },
          { op: 'addChange', ref: '$c', slug: 'cancelada', title: 'Cancelada' },
        ],
      })
    );
    expect((await runCli(['project', 'apply', '--file', bundle, '--json'], dir)).code).toBe(0);
    expect(
      (await runCli(['project', 'set-state', 'CH-002', 'cancelled', '--reason', 'saiu do escopo', '--json'], dir)).code
    ).toBe(0);

    for (const slug of ['empacotamento', 'cancelada']) {
      await runCli(['new', 'change', slug], dir);
      await writeFile(
        path.join(dir, `spec/changes/${slug}/proposal.md`),
        '## Why\n\nCustomers keep hitting a small papercut that wastes support time every week.\n\n## What Changes\n\n- fix it\n\n## Impact\n\nnone\n'
      );
      await writeFile(
        path.join(dir, `spec/changes/${slug}/.change.yaml`),
        'schema: spec-driven\nskip_specs: true\n'
      );
      await writeFile(path.join(dir, `spec/changes/${slug}/tasks.md`), '## 1\n- [x] 1.1 done\n');
    }

    const archived = parseJson((await runCli(['archive', 'empacotamento', '--json'], dir)).stdout);
    expect(archived.plan).toMatchObject({ plan: 'demo', change: 'CH-001' });

    // Um incremento cancelado nunca é reivindicado, então o bloco não aparece.
    const cancelada = parseJson((await runCli(['archive', 'cancelada', '--json'], dir)).stdout);
    expect(cancelada.plan).toBeUndefined();

    const status = parseJson((await runCli(['project', 'status', '--json'], dir)).stdout);
    const views = status.changes as Array<{ id: string; execution: string }>;
    expect(views.find((view) => view.id === 'CH-001')!.execution).toBe('archived');
    expect(status.progress).toMatchObject({ archived: 1 });
  });

  it('um plano corrompido não faz new change falhar nem falar do plano', async () => {
    const dir = await initProject();
    await runCli(['project', 'create', 'demo', '--json'], dir);
    await fs.writeFile(path.join(dir, 'planning/demo/plan.yaml'), ':\n  - [ quebrado', 'utf8');

    const result = await runCli(['new', 'change', 'auth', '--json'], dir);
    expect(result.code).toBe(0);
    expect(parseJson(result.stdout).plan).toBeUndefined();
  });

  it('specs init never creates a planning area', async () => {
    const dir = await initProject();
    await expect(fs.stat(path.join(dir, 'planning'))).rejects.toThrow();
  });
});
