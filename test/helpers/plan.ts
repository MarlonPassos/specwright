import path from 'node:path';
import { promises as fs } from 'node:fs';
import { makeWorkspace, writeFile } from './workspace.js';
import type { Workspace } from '../../src/core/workspace.js';
import {
  renderManifest,
  type PlanManifest,
  type ProjectChange,
} from '../../src/core/project/model.js';
import { planPaths, plannedChangeFileName } from '../../src/core/project/paths.js';
import { renderPlannedChange } from '../../src/core/project/planned-change.js';
import { recordHash, sha256, sourceHash } from '../../src/core/project/hashes.js';
import { emptyRoadmapBlock } from '../../src/core/project/templates.js';

export { makeWorkspace as makePlanWorkspace };

const STAMP = '2026-09-01';

/** A minimal valid manifest; override any field. */
export function manifest(overrides: Partial<PlanManifest> = {}): PlanManifest {
  return {
    schema_version: 1,
    revision: 0,
    id: 'demo',
    name: 'Plano demo',
    status: 'active',
    created_at: STAMP,
    updated_at: STAMP,
    source_documents: [],
    milestones: [],
    changes: [],
    ...overrides,
  };
}

/** A Project Change record with sane defaults. */
export function change(overrides: Partial<ProjectChange> & { id: string; slug: string }): ProjectChange {
  return {
    title: overrides.slug,
    planning_state: 'planned',
    priority: 'medium',
    depends_on: [],
    manual_blockers: [],
    superseded_by: [],
    milestone: null,
    planned_change: null,
    link: null,
    ...overrides,
  };
}

export interface SeedPlanOptions {
  /** Also write plan.md / architecture.md. Default true. */
  documents?: boolean;
}

/** Writes a manifest (and the two human docs) into `planning/<id>/`. */
export async function seedPlan(
  workspace: Workspace,
  data: PlanManifest,
  options: SeedPlanOptions = {}
): Promise<string> {
  const paths = planPaths(workspace.projectRoot, data.id);
  await fs.mkdir(paths.plannedChangesDir, { recursive: true });
  await writeFile(paths.manifest, renderManifest(data));
  if (options.documents !== false) {
    await writeFile(paths.planDoc, `# ${data.name}\n\n## Visão\n\nDemo.\n\n${emptyRoadmapBlock()}\n`);
    await writeFile(paths.architecture, `# Arquitetura — ${data.name}\n\n## Componentes\n\nDemo.\n`);
  }
  return paths.dir;
}

/** Writes a Planned Change file. Returns the absolute path. */
export async function seedPlannedChange(
  workspace: Workspace,
  planId: string,
  spec: {
    id: string;
    slug: string;
    title?: string;
    planRevision?: number;
    sections?: Parameters<typeof renderPlannedChange>[0]['sections'];
    body?: string;
  }
): Promise<string> {
  const paths = planPaths(workspace.projectRoot, planId);
  const file = path.join(paths.plannedChangesDir, plannedChangeFileName(spec.id, spec.slug));
  const content =
    spec.body ??
    renderPlannedChange({
      id: spec.id,
      slug: spec.slug,
      title: spec.title ?? spec.slug,
      planRevision: spec.planRevision ?? 0,
      sections: spec.sections ?? {
        Objetivo: 'Entregar o incremento descrito.',
        Escopo: '- item de escopo',
        'Critérios macro': '- um critério verificável',
      },
    });
  await writeFile(file, content);
  return file;
}

/** Convenience: hashes for a Planned Change ref given the current source set. */
export async function hashesFor(
  workspace: Workspace,
  sources: string[],
  content: string
): Promise<{ source_hash: string; content_hash: string }> {
  const hashable = await Promise.all(
    sources.map(async (relative) => ({
      path: relative,
      content: await fs
        .readFile(path.join(workspace.projectRoot, relative), 'utf8')
        .catch(() => undefined as string | undefined),
    }))
  );
  return { source_hash: sourceHash(hashable), content_hash: sha256(content) };
}

/** Writes a Planned Change ref onto a change with hashes matching the seeded file. */
export async function withBrief(
  workspace: Workspace,
  planId: string,
  c: ProjectChange
): Promise<ProjectChange> {
  const file = await seedPlannedChange(workspace, planId, {
    id: c.id,
    slug: c.slug,
    title: c.title,
  });
  const content = await fs.readFile(file, 'utf8');
  return {
    ...c,
    planned_change: {
      path: `planned-changes/${plannedChangeFileName(c.id, c.slug)}`,
      generated_from_plan_revision: 0,
      source_hash: sourceHash([]),
      content_hash: sha256(content),
      record_hash: recordHash({
        slug: c.slug,
        title: c.title,
        dependsOn: c.depends_on,
        milestone: c.milestone,
      }),
    },
  };
}

/** Creates `spec/changes/archive/<date>-<slug>/` so evidence resolves `archived`. */
export async function seedArchivedChange(
  workspace: Workspace,
  slug: string,
  date = '2026-09-01'
): Promise<string> {
  const dir = path.join(workspace.archivePath, `${date}-${slug}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'proposal.md'), '# archived\n');
  return dir;
}

/** fixture: 3 increments, linear chain, one milestone, all with skeleton briefs. */
export function planSimple(): PlanManifest {
  return manifest({
    id: 'simple',
    name: 'Plano simples',
    status: 'active',
    milestones: [{ id: 'M1', name: 'Fundação', order: 1, changes: ['CH-001', 'CH-002', 'CH-003'] }],
    changes: [
      change({ id: 'CH-001', slug: 'foundation', title: 'Fundação', priority: 'critical', milestone: 'M1' }),
      change({ id: 'CH-002', slug: 'auth', title: 'Autenticação', depends_on: ['CH-001'], milestone: 'M1' }),
      change({ id: 'CH-003', slug: 'catalog', title: 'Catálogo', depends_on: ['CH-002'], milestone: 'M1' }),
    ],
  });
}
