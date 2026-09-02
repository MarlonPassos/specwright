import path from 'node:path';
import { SpecError } from '../../util/errors.js';
import { localDateStamp } from '../../util/date.js';
import { readFileIfExists, writeFileAtomic, withStaging } from '../../util/fs.js';
import { type Workspace } from '../workspace.js';
import { loadPlan } from './repository.js';
import { ProjectGraph } from './graph.js';
import { sha256, sourceHash, type HashableSource } from './hashes.js';
import { renderManifest, type PlanManifest, type ProjectChange } from './model.js';
import { plannedChangeRelPath, resolveWithinRoot } from './paths.js';
import { renderPlannedChange } from './planned-change.js';
import { renderRoadmapBlock, spliceRoadmap } from './render.js';
import { computeProjectStatus, roadmapRows } from './status.js';

export interface GenerateOptions {
  changeIds?: string[];
  milestone?: string;
  dryRun?: boolean;
  force?: boolean;
  expectRevision?: number;
  now?: Date;
}

export interface GenerateConflict {
  id: string;
  path: string;
  state: 'modified';
  recordedContentHash: string;
  currentContentHash: string;
  message: string;
}

export interface GenerateResult {
  generated: boolean;
  dryRun: boolean;
  revision?: { from: number; to: number };
  selection: { milestone: string | null; changes: string[] };
  written: string[];
  skipped: { id: string; reason: string }[];
  conflicts: GenerateConflict[];
  diagnostics: unknown[];
}

export async function generatePlannedChanges(
  workspace: Workspace,
  id: string,
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const { manifest, paths } = await loadPlan(workspace.projectRoot, id);

  if (options.expectRevision !== undefined && options.expectRevision !== manifest.revision) {
    throw new SpecError(
      `A revisão no disco é ${manifest.revision}, mas o comando esperava ${options.expectRevision}.`,
      { code: 'plan_revision_conflict', fix: 'specs project status --json' }
    );
  }

  // Graph validity precedes any write.
  ProjectGraph.from(manifest.changes);

  const selected = selectChanges(manifest, options);

  // Current source hash — the whole source set in the MVP.
  const sources: HashableSource[] = [];
  for (const source of manifest.source_documents) {
    let content: string | undefined;
    try {
      content = await readFileIfExists(
        resolveWithinRoot(workspace.projectRoot, source.path, 'unsafe_source_path')
      );
    } catch {
      content = undefined;
    }
    sources.push({ path: source.path, content });
  }
  const currentSourceHash = sourceHash(sources);

  const toWrite = new Map<string, { relPath: string; content: string }>();
  const nextRefs = new Map<string, ProjectChange['planned_change']>();
  const skipped: GenerateResult['skipped'] = [];
  const conflicts: GenerateConflict[] = [];

  for (const change of selected) {
    const relPath = plannedChangeRelPath(change.id, change.slug);
    const absolute = path.join(paths.dir, relPath);
    const existing = await readFileIfExists(absolute);
    const ref = change.planned_change;

    const currentContentHash = existing === undefined ? undefined : sha256(existing);
    const state =
      ref === null || existing === undefined
        ? 'missing'
        : currentContentHash !== ref.content_hash
          ? 'modified'
          : currentSourceHash !== ref.source_hash
            ? 'outdated'
            : 'current';

    if (state === 'current') {
      skipped.push({ id: change.id, reason: 'planned_change_current' });
      continue;
    }

    if (state === 'modified' && !options.force) {
      conflicts.push({
        id: change.id,
        path: `${status_rel(workspace, paths.dir)}/${relPath}`,
        state: 'modified',
        recordedContentHash: ref!.content_hash,
        currentContentHash: currentContentHash!,
        message: 'O arquivo foi editado depois da última materialização e não será sobrescrito.',
      });
      continue;
    }

    // Body: keep whatever content already exists; only fall to a skeleton when
    // there is no file. `generate` never invents prose.
    const body =
      existing !== undefined
        ? existing
        : renderPlannedChange({
            id: change.id,
            slug: change.slug,
            title: change.title,
            planRevision: manifest.revision + 1,
          });

    toWrite.set(change.id, { relPath, content: body });
    nextRefs.set(change.id, {
      path: relPath,
      generated_from_plan_revision: manifest.revision + 1,
      source_hash: currentSourceHash,
      content_hash: sha256(body),
    });
  }

  if (conflicts.length > 0) {
    return {
      generated: false,
      dryRun: options.dryRun === true,
      selection: { milestone: options.milestone ?? null, changes: selected.map((c) => c.id) },
      written: [],
      skipped,
      conflicts,
      diagnostics: [],
    };
  }

  const written = [...toWrite.values()].map(
    (entry) => `${status_rel(workspace, paths.dir)}/${entry.relPath}`
  );

  if (options.dryRun) {
    return {
      generated: false,
      dryRun: true,
      revision: { from: manifest.revision, to: manifest.revision },
      selection: { milestone: options.milestone ?? null, changes: selected.map((c) => c.id) },
      written,
      skipped,
      conflicts: [],
      diagnostics: [],
    };
  }

  if (toWrite.size === 0) {
    // Nothing changed and nothing to skip-with-write: idempotent no-op.
    return {
      generated: true,
      dryRun: false,
      revision: { from: manifest.revision, to: manifest.revision },
      selection: { milestone: options.milestone ?? null, changes: selected.map((c) => c.id) },
      written: [],
      skipped,
      conflicts: [],
      diagnostics: [],
    };
  }

  // Stage the brief files, then the manifest, then project the roadmap.
  await withStaging(paths.dir, async (stage) => {
    for (const entry of toWrite.values()) {
      stage(entry.relPath, entry.content);
    }
  });

  const nextManifest: PlanManifest = {
    ...manifest,
    revision: manifest.revision + 1,
    updated_at: localDateStamp(options.now ?? new Date()),
    changes: manifest.changes.map((change) => {
      const ref = nextRefs.get(change.id);
      return ref ? { ...change, planned_change: ref } : change;
    }),
  };
  await writeFileAtomic(paths.manifest, renderManifest(nextManifest));

  const planDoc = await readFileIfExists(paths.planDoc);
  if (planDoc !== undefined) {
    const status = await computeProjectStatus(workspace, id);
    const block = renderRoadmapBlock({ manifest: nextManifest, rows: roadmapRows(status) });
    await writeFileAtomic(paths.planDoc, spliceRoadmap(planDoc, block));
  }

  return {
    generated: true,
    dryRun: false,
    revision: { from: manifest.revision, to: nextManifest.revision },
    selection: { milestone: options.milestone ?? null, changes: selected.map((c) => c.id) },
    written,
    skipped,
    conflicts: [],
    diagnostics: [],
  };
}

function selectChanges(manifest: PlanManifest, options: GenerateOptions): ProjectChange[] {
  const byId = new Map(manifest.changes.map((change) => [change.id, change]));

  if (options.changeIds && options.changeIds.length > 0) {
    return options.changeIds.map((wanted) => {
      const change = byId.get(wanted);
      if (!change) {
        throw new SpecError(`O incremento ${wanted} não existe no plano.`, {
          code: 'change_not_found',
          fix: 'specs project status --json',
        });
      }
      if (change.planning_state !== 'planned') {
        throw new SpecError(
          `${wanted} tem planning_state "${change.planning_state}"; só um incremento "planned" pode ser materializado.`,
          { code: 'plan_invalid', fix: `specs project set-state ${wanted} planned` }
        );
      }
      return change;
    });
  }

  if (options.milestone) {
    const milestone = manifest.milestones.find((entry) => entry.id === options.milestone);
    if (!milestone) {
      throw new SpecError(`O milestone ${options.milestone} não existe.`, {
        code: 'plan_invalid',
        fix: 'specs project status --json',
      });
    }
    return manifest.changes.filter(
      (change) => change.milestone === milestone.id && change.planning_state === 'planned'
    );
  }

  return manifest.changes.filter((change) => change.planning_state === 'planned');
}

function status_rel(workspace: Workspace, planDir: string): string {
  return path.relative(workspace.projectRoot, planDir).replace(/\\/g, '/');
}
