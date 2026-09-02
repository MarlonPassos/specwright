import path from 'node:path';
import { promises as fs } from 'node:fs';
import { SpecError } from '../../util/errors.js';
import { readFileIfExists, writeFileAtomic, withStaging } from '../../util/fs.js';
import { type Workspace } from '../workspace.js';
import { loadPlan } from './repository.js';
import { computeProjectStatus, roadmapRows } from './status.js';
import { computeImpact, type ImpactResult } from './impact.js';
import { renderRoadmapBlock, spliceRoadmap } from './render.js';
import { sha256, sourceHash, recordHash, type HashableSource } from './hashes.js';
import { renderManifest } from './model.js';
import { resolveWithinRoot } from './paths.js';
import { validatePlan } from './validate.js';
import {
  applyBundle,
  parseBundle,
  renderBriefFromSpec,
  type Bundle,
} from './bundle.js';

export interface ApplyOptions {
  dryRun?: boolean;
  allowCompleted?: boolean;
  now?: Date;
}

export interface ApplyResult {
  applied: boolean;
  dryRun: boolean;
  revision: { from: number; to: number };
  idMap: Record<string, string>;
  written: string[];
  removed: string[];
  impact: ImpactResult | null;
  validation: { valid: boolean; errors: number; warnings: number };
  diagnostics: Array<{ level: string; code: string; message: string }>;
}

export async function applyPlanBundle(
  workspace: Workspace,
  planId: string,
  rawBundle: unknown,
  options: ApplyOptions = {}
): Promise<ApplyResult> {
  const bundle: Bundle = parseBundle(rawBundle);
  const { manifest, paths } = await loadPlan(workspace.projectRoot, planId);

  const status = await computeProjectStatus(workspace, planId);
  const archivedIds = new Set(
    status.changes.filter((change) => change.execution === 'archived').map((change) => change.id)
  );

  // Pre-resolve the hashes for any source the bundle declares (applyBundle is sync).
  const sourceHashes = new Map<string, string>();
  for (const declared of bundle.plan?.sourceDocuments ?? []) {
    try {
      const content = await readFileIfExists(
        resolveWithinRoot(workspace.projectRoot, declared, 'unsafe_source_path')
      );
      if (content !== undefined) sourceHashes.set(declared, sha256(content));
    } catch {
      /* unsafe path: leave unresolved, validate will flag it */
    }
  }
  const resolveSourceHash = (declared: string): string | undefined => sourceHashes.get(declared);

  const result = applyBundle(manifest, bundle, {
    archivedIds,
    allowCompleted: options.allowCompleted === true,
    resolveSourceHash,
    now: options.now,
  });

  // Current source hash for the proposed state's briefs.
  const sources: HashableSource[] = [];
  for (const source of result.manifest.source_documents) {
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

  // Render pending briefs and finalise their refs.
  const briefFiles = new Map<string, string>(); // relPath -> content
  for (const pending of result.pendingBriefs) {
    const record = result.manifest.changes.find((change) => change.id === pending.id)!;
    const body = renderBriefFromSpec(
      pending.id,
      pending.slug,
      record.title,
      result.manifest.revision,
      pending.spec
    );
    const relPath = record.planned_change!.path;
    briefFiles.set(relPath, body);
    record.planned_change = {
      path: relPath,
      generated_from_plan_revision: result.manifest.revision,
      source_hash: currentSourceHash,
      content_hash: sha256(body),
      record_hash: recordHash({
        slug: record.slug,
        title: record.title,
        dependsOn: record.depends_on,
        milestone: record.milestone,
      }),
    };
  }

  const targets = collectTargets(bundle, result.idMap);
  const impact =
    targets.length > 0 ? await computeImpact(workspace, planId, existingTargets(targets, status)) : null;

  const planRel = path.relative(workspace.projectRoot, paths.dir).replace(/\\/g, '/');
  const written = [
    ...[...briefFiles.keys()].map((relPath) => `${planRel}/${relPath}`),
    `${planRel}/plan.yaml`,
    `${planRel}/plan.md`,
    ...(result.documents.some((doc) => doc.target === 'architecture')
      ? [`${planRel}/architecture.md`]
      : []),
  ];
  const removed = result.briefRenames.map((rename) => `${planRel}/${rename.from}`);

  const diagnostics = result.completedTouched.map((id) => ({
    level: 'WARNING',
    code: 'completed_change_protected',
    message: `${id} está concluído e foi alterado com --allow-completed`,
  }));

  if (options.dryRun) {
    return {
      applied: false,
      dryRun: true,
      revision: { from: manifest.revision, to: manifest.revision },
      idMap: result.idMap,
      written,
      removed,
      impact,
      validation: { valid: true, errors: 0, warnings: 0 },
      diagnostics,
    };
  }

  // Stage every planning file, then rename atomically.
  const planDocSource =
    result.documents.find((doc) => doc.target === 'plan')?.content ??
    (await readFileIfExists(paths.planDoc)) ??
    '';
  const architectureDoc = result.documents.find((doc) => doc.target === 'architecture')?.content;

  await withStaging(paths.dir, async (stage) => {
    for (const [relPath, content] of briefFiles) stage(relPath, content);
    stage('plan.yaml', renderManifest(result.manifest));
    if (architectureDoc !== undefined) stage('architecture.md', architectureDoc);
  });

  // Old brief files after a slug rename.
  for (const rename of result.briefRenames) {
    if (rename.from !== rename.to) {
      await fs.rm(path.join(paths.dir, rename.from), { force: true });
    }
  }

  // Project the roadmap into plan.md from the freshly written state.
  const fresh = await computeProjectStatus(workspace, planId);
  const block = renderRoadmapBlock({ manifest: fresh.manifest, rows: roadmapRows(fresh) });
  await writeFileAtomic(paths.planDoc, spliceRoadmap(planDocSource, block));

  const reports = await validatePlan(workspace.projectRoot, planId, {});
  const validation = {
    valid: reports.every((report) => report.valid),
    errors: reports.reduce((total, report) => total + report.summary.errors, 0),
    warnings: reports.reduce((total, report) => total + report.summary.warnings, 0),
  };

  return {
    applied: true,
    dryRun: false,
    revision: { from: manifest.revision, to: result.manifest.revision },
    idMap: result.idMap,
    written,
    removed,
    impact,
    validation,
    diagnostics,
  };
}

function collectTargets(bundle: Bundle, idMap: Record<string, string>): string[] {
  const ids = new Set<string>();
  for (const operation of bundle.operations) {
    if ('id' in operation && typeof operation.id === 'string') ids.add(operation.id);
    if (operation.op === 'mergeChanges') operation.ids.forEach((id) => ids.add(id));
  }
  return [...ids].map((id) => idMap[id] ?? id);
}

function existingTargets(
  targets: string[],
  status: Awaited<ReturnType<typeof computeProjectStatus>>
): string[] {
  const known = new Set(status.changes.map((change) => change.id));
  return targets.filter((id) => known.has(id));
}
