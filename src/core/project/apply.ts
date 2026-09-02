import path from 'node:path';
import { promises as fs } from 'node:fs';
import { SpecError } from '../../util/errors.js';
import { readFileIfExists, writeFileAtomic, withStaging } from '../../util/fs.js';
import { type Workspace } from '../workspace.js';
import { loadPlan, withPlanLock, parseManifest } from './repository.js';
import { computeProjectStatus, roadmapRows } from './status.js';
import { computeImpact, type ImpactResult } from './impact.js';
import { assertRoadmapMarkers, renderRoadmapBlock, spliceRoadmap } from './render.js';
import { sha256, sourceHash, recordHash, type HashableSource } from './hashes.js';
import { renderManifest } from './model.js';
import { resolveWithinRoot, safeResolve } from './paths.js';
import { validatePlan, validateProposedPlan, validatePlannedChangeContent } from './validate.js';
import {
  applyBundle,
  parseBundle,
  renderBriefFromSpec,
  type Bundle,
} from './bundle.js';

export interface ApplyOptions {
  dryRun?: boolean;
  allowCompleted?: boolean;
  /** CLI-level guard; must match the revision on disk (FR-39). */
  expectRevision?: number;
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

  if (options.expectRevision !== undefined && options.expectRevision !== manifest.revision) {
    throw new SpecError(
      `A revisão no disco é ${manifest.revision}, mas o comando esperava ${options.expectRevision}.`,
      { code: 'plan_revision_conflict', fix: 'specs project status --json' }
    );
  }

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
    projectRoot: workspace.projectRoot,
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

  // A slug rename moves the brief: carry the existing bytes to the new path and
  // rewrite the `slug:` in its frontmatter, so every reference moves in the same
  // transaction. Without this the old file was deleted with nothing written in
  // its place, and the frontmatter would contradict the manifest (FR-43, AC-50).
  for (const rename of result.briefRenames) {
    if (rename.from === rename.to || briefFiles.has(rename.to)) continue;
    const carriedFrom = safeResolve(paths.dir, rename.from);
    const carried = carriedFrom === undefined ? undefined : await readFileIfExists(carriedFrom);
    if (carried === undefined) continue;

    const record = result.manifest.changes.find(
      (entry) => entry.planned_change?.path === rename.to
    );
    const body = record ? rewriteBriefSlug(carried, record.slug) : carried;
    briefFiles.set(rename.to, body);

    if (record?.planned_change) {
      record.planned_change = {
        ...record.planned_change,
        content_hash: sha256(body),
        record_hash: recordHash({
          slug: record.slug,
          title: record.title,
          dependsOn: record.depends_on,
          milestone: record.milestone,
        }),
      };
    }
  }

  // FALHAR ANTES DE GRAVAR (§4.1.5, regra 11 de §7.11). The proposed tree is
  // EVERY brief the plan will have after the commit, not only the ones this
  // bundle writes: a brief already invalid on disk used to survive a mutation
  // that merely touched `priority`, leaving the plan invalid.
  const proposedIssues: Array<{ level: string; path: string; message: string; changeId: string }> = [];
  for (const record of result.manifest.changes) {
    const ref = record.planned_change;
    if (!ref) continue;

    let content = briefFiles.get(ref.path);
    if (content === undefined) {
      const absolute = safeResolve(paths.dir, ref.path);
      content = absolute === undefined ? undefined : await readFileIfExists(absolute);
    }
    if (content === undefined) {
      proposedIssues.push({
        level: 'ERROR',
        path: ref.path,
        message: `o Planned Change de ${record.id} não existe no disco`,
        changeId: record.id,
      });
      continue;
    }
    proposedIssues.push(
      ...validatePlannedChangeContent(content, { id: record.id, slug: record.slug }, ref.path).map(
        (issue) => ({ ...issue, changeId: record.id })
      )
    );
  }
  // What this bundle touches must be valid — that is the pre-write guarantee.
  // A brief that was ALREADY invalid elsewhere is surfaced as a diagnostic
  // instead of blocking: `generate` writes a deliberately invalid skeleton for
  // an increment with no content yet (§7.5), and blocking on it would deadlock
  // the documented workflow. Such an increment can never be `ready` — `status`
  // reports `planned_change_invalid` and readiness falls to `blocked`.
  const touched = new Set(collectTargets(bundle, result.idMap));
  for (const relPath of briefFiles.keys()) {
    const record = result.manifest.changes.find((entry) => entry.planned_change?.path === relPath);
    if (record) touched.add(record.id);
  }

  const blocking = proposedIssues.filter(
    (issue) => issue.level === 'ERROR' && touched.has(issue.changeId)
  );
  if (blocking.length > 0) {
    throw new SpecError(
      `O estado proposto é inválido; nada foi escrito:\n${blocking
        .map((issue) => `  - ${issue.path}: ${issue.message}`)
        .join('\n')}`,
      { code: 'plan_invalid', fix: 'specs project validate --json' }
    );
  }
  // One diagnostic per increment, not one per rule it violates.
  const alreadyInvalid = new Map<string, string[]>();
  for (const issue of proposedIssues) {
    if (issue.level !== 'ERROR' || touched.has(issue.changeId)) continue;
    alreadyInvalid.set(issue.changeId, [
      ...(alreadyInvalid.get(issue.changeId) ?? []),
      issue.message,
    ]);
  }
  for (const [changeId, messages] of alreadyInvalid) {
    diagnostics.push({
      level: 'WARNING',
      code: 'planned_change_invalid',
      message: `${changeId} já tinha um Planned Change inválido antes desta mutação: ${messages.join('; ')}`,
    });
  }

  if (options.dryRun) {
    // A preview that reports the CURRENT revision and a hardcoded clean bill of
    // health is worse than no preview: the assistant shows the user `0 → 0` and
    // `0 warnings`, then the real apply lands on a different revision with
    // warnings attached. Report the projected revision and the issue counts
    // actually computed for the proposed state.
    const proposedReports = await validateProposedPlan(
      workspace.projectRoot,
      planId,
      result.manifest,
      briefFiles
    );
    const errors = proposedReports.reduce((total, report) => total + report.summary.errors, 0);
    const warnings = proposedReports.reduce((total, report) => total + report.summary.warnings, 0);
    return {
      applied: false,
      dryRun: true,
      revision: { from: manifest.revision, to: result.manifest.revision },
      idMap: result.idMap,
      written,
      removed,
      impact,
      validation: { valid: errors === 0, errors, warnings },
      diagnostics,
    };
  }

  // Stage every planning file, then rename atomically.
  const planDocSource =
    result.documents.find((doc) => doc.target === 'plan')?.content ??
    (await readFileIfExists(paths.planDoc)) ??
    '';
  const architectureDoc = result.documents.find((doc) => doc.target === 'architecture')?.content;

  // Fail before the first byte: an unbalanced roadmap marker must not leave a
  // half-applied plan behind (AC-21, NFR-07).
  assertRoadmapMarkers(planDocSource);

  // The whole commit runs under the plan lock, and the revision is re-checked
  // inside it, so a concurrent writer cannot slip between the check and the write.
  await withPlanLock(paths, async () => {
    const onDisk = await readFileIfExists(paths.manifest);
    const current = onDisk === undefined ? undefined : parseManifest(onDisk).manifest;
    if (current && current.revision !== manifest.revision) {
      throw new SpecError(
        `O plano mudou para a revisão ${current.revision} enquanto este apply trabalhava na ${manifest.revision}.`,
        { code: 'plan_revision_conflict', fix: 'specs project status --json' }
      );
    }
    await withStaging(paths.dir, async (stage) => {
      for (const [relPath, content] of briefFiles) stage(relPath, content);
      stage('plan.yaml', renderManifest(result.manifest));
      if (architectureDoc !== undefined) stage('architecture.md', architectureDoc);
    });
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

/** Replaces the `slug:` line inside a brief's frontmatter block. */
function rewriteBriefSlug(brief: string, slug: string): string {
  const normalized = brief.replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) return normalized;
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return normalized;
  const frontmatter = normalized.slice(0, end);
  const rest = normalized.slice(end);
  return `${frontmatter.replace(/^slug:.*$/m, `slug: ${slug}`)}${rest}`;
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
