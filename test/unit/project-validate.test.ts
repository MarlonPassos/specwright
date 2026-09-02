import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validatePlan } from '../../src/core/project/validate.js';
import { sha256, sourceHash } from '../../src/core/project/hashes.js';
import { plannedChangeRelPath } from '../../src/core/project/paths.js';
import {
  makePlanWorkspace,
  seedPlan,
  seedPlannedChange,
  manifest,
  change,
  planSimple,
} from '../helpers/plan.js';
import { writeFile } from '../helpers/workspace.js';

function issues(reports: Awaited<ReturnType<typeof validatePlan>>, level?: string) {
  return reports.flatMap((report) =>
    report.issues.filter((issue) => !level || issue.level === level).map((issue) => issue.message)
  );
}

describe('validatePlan — manifest rules', () => {
  it('accepts a clean plan with skeleton-free briefs', async () => {
    const workspace = await makePlanWorkspace();
    const plan = planSimple();
    for (const c of plan.changes) {
      const rel = plannedChangeRelPath(c.id, c.slug);
      const file = await seedPlannedChange(workspace, plan.id, { id: c.id, slug: c.slug, title: c.title });
      c.planned_change = {
        path: rel,
        generated_from_plan_revision: 0,
        source_hash: sourceHash([]),
        content_hash: sha256(await fs.readFile(file, 'utf8')),
      };
    }
    await seedPlan(workspace, plan);
    const reports = await validatePlan(workspace.projectRoot, plan.id, { strict: false });
    expect(reports.every((report) => report.valid)).toBe(true);
  });

  it('flags a plan id that differs from the directory name', async () => {
    const workspace = await makePlanWorkspace();
    const data = manifest({ id: 'declared' });
    await seedPlan(workspace, data);
    // rename the directory so the folder no longer matches manifest.id
    await fs.rename(
      path.join(workspace.projectRoot, 'planning', 'declared'),
      path.join(workspace.projectRoot, 'planning', 'ondisk')
    );
    const reports = await validatePlan(workspace.projectRoot, 'ondisk', {});
    expect(issues(reports, 'ERROR').join(' ')).toMatch(/diretório/);
  });

  it('throws unsupported_plan_version for a newer schema', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'demo' }));
    await fs.writeFile(
      path.join(workspace.projectRoot, 'planning/demo/plan.yaml'),
      'schema_version: 99\nid: demo\n'
    );
    await expect(validatePlan(workspace.projectRoot, 'demo', {})).rejects.toMatchObject({
      code: 'unsupported_plan_version',
    });
  });

  it('reports Zod field-path violations as ERROR issues', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'demo' }));
    await fs.writeFile(
      path.join(workspace.projectRoot, 'planning/demo/plan.yaml'),
      'schema_version: 1\nrevision: -1\nid: demo\nname: X\nstatus: active\ncreated_at: 2026-09-01\nupdated_at: 2026-09-01\n'
    );
    const reports = await validatePlan(workspace.projectRoot, 'demo', {});
    expect(reports[0].valid).toBe(false);
    expect(reports[0].issues.some((issue) => issue.path === 'revision')).toBe(true);
  });

  it('flags a duplicate change id', async () => {
    const workspace = await makePlanWorkspace();
    const data = manifest({
      changes: [change({ id: 'CH-001', slug: 'a' }), change({ id: 'CH-001', slug: 'b' })],
    });
    await seedPlan(workspace, data);
    const reports = await validatePlan(workspace.projectRoot, data.id, {});
    expect(issues(reports, 'ERROR').join(' ')).toMatch(/duplicad/);
  });

  it('flags a dependency cycle before any write', async () => {
    const workspace = await makePlanWorkspace();
    const data = manifest({
      changes: [
        change({ id: 'CH-001', slug: 'a', depends_on: ['CH-003'] }),
        change({ id: 'CH-002', slug: 'b', depends_on: ['CH-001'] }),
        change({ id: 'CH-003', slug: 'c', depends_on: ['CH-002'] }),
      ],
    });
    await seedPlan(workspace, data);
    const errors = issues(await validatePlan(workspace.projectRoot, data.id, {}), 'ERROR').join(' ');
    expect(errors).toMatch(/Ciclo de dependência/);
  });

  it('flags an unknown dependency and a self dependency', async () => {
    const workspace = await makePlanWorkspace();
    const data = manifest({
      changes: [
        change({ id: 'CH-001', slug: 'a', depends_on: ['CH-001'] }),
        change({ id: 'CH-002', slug: 'b', depends_on: ['CH-099'] }),
      ],
    });
    await seedPlan(workspace, data);
    const errors = issues(await validatePlan(workspace.projectRoot, data.id, {}), 'ERROR').join(' ');
    expect(errors).toMatch(/depende de si mesmo/);
    expect(errors).toMatch(/CH-099/);
  });

  it('flags a source path that escapes the project root', async () => {
    const workspace = await makePlanWorkspace();
    const data = manifest({ source_documents: [{ path: '../outside.md', sha256: 'x' }] });
    await seedPlan(workspace, data);
    const reports = await validatePlan(workspace.projectRoot, data.id, {});
    expect(
      reports[0].issues.some((issue) => issue.level === 'ERROR' && /\.\./.test(issue.message))
    ).toBe(true);
  });

  it('warns (not errors) on a missing source without --strict', async () => {
    const workspace = await makePlanWorkspace();
    const data = manifest({ source_documents: [{ path: 'docs/missing.md', sha256: 'x' }] });
    await seedPlan(workspace, data);
    const reports = await validatePlan(workspace.projectRoot, data.id, { strict: false });
    expect(reports[0].valid).toBe(true);
    expect(issues(reports, 'WARNING').join(' ')).toMatch(/missing_source/);
  });

  it('warns on a source whose hash drifted', async () => {
    const workspace = await makePlanWorkspace();
    await writeFile(path.join(workspace.projectRoot, 'docs/vision.md'), 'current content');
    const data = manifest({ source_documents: [{ path: 'docs/vision.md', sha256: sha256('old content') }] });
    await seedPlan(workspace, data);
    const reports = await validatePlan(workspace.projectRoot, data.id, {});
    expect(issues(reports, 'WARNING').join(' ')).toMatch(/source_changed/);
  });

  it('flags an inconsistent milestone relation', async () => {
    const workspace = await makePlanWorkspace();
    const data = manifest({
      milestones: [{ id: 'M1', name: 'Um', order: 1, changes: ['CH-001'] }],
      changes: [change({ id: 'CH-001', slug: 'a', milestone: null })],
    });
    await seedPlan(workspace, data);
    expect(issues(await validatePlan(workspace.projectRoot, data.id, {}), 'ERROR').join(' ')).toMatch(
      /milestone/
    );
  });

  it('flags two increments sharing a link name', async () => {
    const workspace = await makePlanWorkspace();
    await fs.mkdir(path.join(workspace.changesPath, 'auth'), { recursive: true });
    const link = {
      name: 'auth',
      active_path: 'spec/changes/auth',
      archive_path: null,
      linked_at: '2026-09-01',
    };
    const data = manifest({
      changes: [
        change({ id: 'CH-001', slug: 'a', link }),
        change({ id: 'CH-002', slug: 'b', link: { ...link } }),
      ],
    });
    await seedPlan(workspace, data);
    expect(issues(await validatePlan(workspace.projectRoot, data.id, {}), 'ERROR').join(' ')).toMatch(
      /duplicate_link/
    );
  });
});

describe('validatePlan — planned change rules', () => {
  async function planWithBrief(bodyOverride?: string, sections?: Record<string, string>) {
    const workspace = await makePlanWorkspace();
    const rel = plannedChangeRelPath('CH-001', 'foundation');
    const file = await seedPlannedChange(workspace, 'demo', {
      id: 'CH-001',
      slug: 'foundation',
      title: 'Fundação',
      body: bodyOverride,
      sections,
    });
    const content = await fs.readFile(file, 'utf8');
    const data = manifest({
      changes: [
        change({
          id: 'CH-001',
          slug: 'foundation',
          title: 'Fundação',
          planned_change: {
            path: rel,
            generated_from_plan_revision: 0,
            source_hash: sourceHash([]),
            content_hash: sha256(content),
          },
        }),
      ],
    });
    await seedPlan(workspace, data);
    return { workspace, data };
  }

  it('errors on an empty Critérios macro and warns on a missing Riscos', async () => {
    const { workspace, data } = await planWithBrief(undefined, {
      Objetivo: 'Entregar a base.',
      Escopo: '- pastas',
      'Critérios macro': '',
    });
    const reports = await validatePlan(workspace.projectRoot, data.id, { strict: false });
    const brief = reports.find((report) => report.type === 'planned-change')!;
    expect(brief.issues.some((issue) => issue.level === 'ERROR' && /Critérios macro/.test(issue.path))).toBe(true);
    expect(brief.issues.some((issue) => issue.level === 'WARNING' && /Riscos/.test(issue.path))).toBe(true);
    expect(brief.valid).toBe(false); // the ERROR alone
  });

  it('a Riscos-only gap is valid without --strict, invalid with it', async () => {
    const { workspace, data } = await planWithBrief(undefined, {
      Objetivo: 'Entregar a base.',
      Escopo: '- pastas',
      'Critérios macro': '- build verde',
    });
    const lenient = await validatePlan(workspace.projectRoot, data.id, { strict: false });
    const strict = await validatePlan(workspace.projectRoot, data.id, { strict: true });
    expect(lenient.every((report) => report.valid)).toBe(true);
    expect(strict.every((report) => report.valid)).toBe(false);
  });

  it('errors on a delta header in the brief', async () => {
    const body = `---
schema_version: 1
id: CH-001
slug: foundation
title: Fundação
plan_revision: 0
---

# Objetivo

Base.

# Escopo

- x

# Critérios macro

- y

## ADDED Requirements

### Requirement: sneaky
`;
    const { workspace, data } = await planWithBrief(body);
    const reports = await validatePlan(workspace.projectRoot, data.id, {});
    expect(issues(reports, 'ERROR').join(' ')).toMatch(/cabeçalho de delta/);
  });

  it('errors when the brief file referenced by the manifest is missing', async () => {
    const workspace = await makePlanWorkspace();
    const data = manifest({
      changes: [
        change({
          id: 'CH-001',
          slug: 'foundation',
          planned_change: {
            path: plannedChangeRelPath('CH-001', 'foundation'),
            generated_from_plan_revision: 0,
            source_hash: 'x',
            content_hash: 'y',
          },
        }),
      ],
    });
    await seedPlan(workspace, data);
    expect(issues(await validatePlan(workspace.projectRoot, data.id, {}), 'ERROR').join(' ')).toMatch(
      /não existe no disco/
    );
  });
});
