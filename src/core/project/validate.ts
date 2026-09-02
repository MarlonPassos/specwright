import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { SpecError } from '../../util/errors.js';
import { pathExists, readFileIfExists } from '../../util/fs.js';
import { buildReport, type ValidationIssue, type ValidationReport } from '../validate/report.js';
import { MAX_DELTAS_PER_CHANGE } from '../validate/rules.js';
import { readDeltaSpecs } from '../change/model.js';
import { CHANGES_DIR, ARCHIVE_DIR, WORKSPACE_DIR } from '../workspace.js';
import { sha256, sourceHash, type HashableSource } from './hashes.js';
import { renderManifest, type PlanManifest, type ProjectChange } from './model.js';
import {
  REQUIRED_PLANNED_CHANGE_SECTIONS,
  PLANNED_CHANGE_SECTIONS,
  parsePlannedChange,
  sectionHasText,
} from './planned-change.js';
import { parseManifest } from './repository.js';
import { ProjectGraph } from './graph.js';
import {
  PLANNED_CHANGES_DIR,
  planPaths,
  plannedChangeFileName,
  resolveWithinRoot,
  type PlanPaths,
} from './paths.js';

const OPTIONAL_STRICT_SECTIONS: Array<(typeof PLANNED_CHANGE_SECTIONS)[number]> = [
  'Motivação',
  'Fora do escopo',
  'Riscos',
  'Notas para exploração',
  'Referências da fonte',
  'Readiness e handoff',
];

interface Ctx {
  projectRoot: string;
  id: string;
  paths: PlanPaths;
  strict: boolean;
  /**
   * Brief bodies that are not on disk yet, keyed by the manifest-relative path.
   * Set when validating a state a bundle *proposes*, so `apply --dry-run` can
   * report the same counts the real apply will produce.
   */
  briefs?: Map<string, string>;
}

/**
 * Validates a plan against §7.17: manifest identity, paths, sources, milestones,
 * links (including cycle detection, oversized and ambiguous-archive) and each
 * Planned Change. `stale_plan_status` is reported by `status` where the derived
 * status is already computed.
 */
export async function validatePlan(
  projectRoot: string,
  id: string,
  options: { strict?: boolean } = {}
): Promise<ValidationReport[]> {
  const strict = options.strict === true;
  const paths = planPaths(projectRoot, id);
  const ctx: Ctx = { projectRoot, id, paths, strict };

  const raw = await readFileIfExists(paths.manifest);
  if (raw === undefined) {
    throw new SpecError(`Nenhum plano "${id}" em planning/.`, {
      code: 'plan_not_found',
      fix: `specs project create ${id}`,
    });
  }

  const parsed = parseManifest(raw);
  if (!parsed.manifest) {
    // An unknown version or unparseable YAML is not a validation finding — no
    // command in the group can operate, so it fails like any other SpecError.
    if (parsed.code === 'unsupported_plan_version' || parsed.code === 'invalid_plan') {
      const detail = parsed.issues.map((issue) => issue.message).join('; ');
      throw new SpecError(`plan.yaml não pôde ser lido: ${detail}`, {
        code: parsed.code,
        ...(parsed.fix ? { fix: parsed.fix } : {}),
      });
    }
    return [
      buildReport(
        id,
        'plan',
        parsed.issues.map((detail) => ({ level: 'ERROR' as const, path: detail.path, message: detail.message })),
        strict
      ),
    ];
  }

  const manifest = parsed.manifest;
  const rawObject = (parseYaml(raw) ?? {}) as Record<string, unknown>;

  const planIssues: ValidationIssue[] = [];
  await checkManifest(ctx, manifest, rawObject, planIssues);

  const reports: ValidationReport[] = [buildReport(id, 'plan', planIssues, strict)];
  for (const change of manifest.changes) {
    if (!change.planned_change) continue;
    reports.push(await validatePlannedChange(ctx, manifest, change));
  }
  return reports;
}

/**
 * Runs the same rules as `validatePlan` against a manifest that exists only in
 * memory, with `briefs` supplying the bodies a bundle would write. Lets a
 * `--dry-run` preview report real counts instead of a hardcoded clean bill.
 */
export async function validateProposedPlan(
  projectRoot: string,
  id: string,
  manifest: PlanManifest,
  briefs: Map<string, string>,
  options: { strict?: boolean } = {}
): Promise<ValidationReport[]> {
  const strict = options.strict === true;
  const ctx: Ctx = { projectRoot, id, paths: planPaths(projectRoot, id), strict, briefs };
  const rawObject = (parseYaml(renderManifest(manifest)) ?? {}) as Record<string, unknown>;

  const planIssues: ValidationIssue[] = [];
  await checkManifest(ctx, manifest, rawObject, planIssues);

  const reports: ValidationReport[] = [buildReport(id, 'plan', planIssues, strict)];
  for (const change of manifest.changes) {
    if (!change.planned_change) continue;
    reports.push(await validatePlannedChange(ctx, manifest, change));
  }
  return reports;
}

async function checkManifest(
  ctx: Ctx,
  manifest: PlanManifest,
  rawObject: Record<string, unknown>,
  issues: ValidationIssue[]
): Promise<void> {
  const error = (p: string, message: string) => issues.push({ level: 'ERROR', path: p, message });
  const warn = (p: string, message: string) => issues.push({ level: 'WARNING', path: p, message });

  // Identity
  if (manifest.id !== ctx.id) {
    error('id', `id do plano é "${manifest.id}" mas o diretório é "${ctx.id}"; devem ser iguais`);
  }

  // Change identity and graph (graph-independent portion)
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const rawChanges = Array.isArray(rawObject.changes) ? (rawObject.changes as unknown[]) : [];
  for (const change of manifest.changes) {
    if (ids.has(change.id)) error(`changes.${change.id}.id`, `id ${change.id} está duplicado`);
    ids.add(change.id);
    if (slugs.has(change.slug)) {
      error(`changes.${change.id}.slug`, `slug "${change.slug}" está duplicado`);
    }
    slugs.add(change.slug);
  }
  for (const change of manifest.changes) {
    for (const dependency of change.depends_on) {
      if (dependency === change.id) {
        error(`changes.${change.id}.depends_on`, `${change.id} depende de si mesmo`);
      } else if (!ids.has(dependency)) {
        error(
          `changes.${change.id}.depends_on`,
          `${change.id} depende de ${dependency}, que o plano não declara`
        );
      }
    }
    for (const superseded of change.superseded_by) {
      if (!ids.has(superseded)) {
        error(
          `changes.${change.id}.superseded_by`,
          `${change.id}.superseded_by cita ${superseded}, que o plano não declara`
        );
      }
    }
  }

  // Cycle: the graph is the authority; identity errors above are reported already.
  try {
    ProjectGraph.from(manifest.changes);
  } catch (graphError) {
    if ((graphError as { code?: string }).code === 'dependency_cycle') {
      error('changes', (graphError as Error).message);
    }
  }

  // priority default applied (WARNING under --strict)
  rawChanges.forEach((rawChange, index) => {
    if (
      rawChange &&
      typeof rawChange === 'object' &&
      (rawChange as Record<string, unknown>).priority === undefined
    ) {
      const declaredId = (rawChange as Record<string, unknown>).id;
      warn(
        `changes.${typeof declaredId === 'string' ? declaredId : index}.priority`,
        'priority ausente; "medium" foi aplicado por padrão'
      );
    }
  });

  // Planned Change refs and paths
  for (const change of manifest.changes) {
    const ref = change.planned_change;
    if (!ref) {
      // §7.17 WARNING 4: a `planned` increment with no materialization at all.
      if (change.planning_state === 'planned') {
        warn(
          `changes.${change.id}.planned_change`,
          `${change.id} está "planned" sem Planned Change materializado (planned_change_missing)`
        );
      }
      continue;
    }
    const expected = `${PLANNED_CHANGES_DIR}/${plannedChangeFileName(change.id, change.slug)}`;
    if (ref.path !== expected) {
      error(
        `changes.${change.id}.planned_change.path`,
        `path deveria ser "${expected}", mas é "${ref.path}"`
      );
      continue;
    }
    try {
      resolveWithinRoot(ctx.paths.dir, ref.path);
    } catch (pathError) {
      error(`changes.${change.id}.planned_change.path`, (pathError as Error).message);
      continue;
    }
    // A brief this bundle is about to write counts as present: a preview must
    // not report an error the real apply will not produce.
    if (!ctx.briefs?.has(ref.path) && !(await pathExists(path.join(ctx.paths.dir, ref.path)))) {
      error(
        `changes.${change.id}.planned_change.path`,
        `o arquivo ${ref.path} não existe no disco`
      );
    }
  }

  // Source documents
  for (let index = 0; index < manifest.source_documents.length; index += 1) {
    const source = manifest.source_documents[index];
    let absolute: string;
    try {
      absolute = resolveWithinRoot(ctx.projectRoot, source.path, 'unsafe_source_path');
    } catch (pathError) {
      error(`source_documents[${index}].path`, (pathError as Error).message);
      continue;
    }
    const content = await readFileIfExists(absolute);
    if (content === undefined) {
      warn(`source_documents[${index}].path`, `${source.path} não existe agora (missing_source)`);
      continue;
    }
    if (sha256(content) !== source.sha256) {
      warn(
        `source_documents[${index}].sha256`,
        `${source.path} mudou desde o registro (source_changed)`
      );
    }
  }

  // Links
  const linkNames = new Map<string, string>();
  for (const change of manifest.changes) {
    const link = change.link;
    if (!link) continue;
    const owner = linkNames.get(link.name);
    if (owner) {
      error(
        `changes.${change.id}.link.name`,
        `a change "${link.name}" já está vinculada a ${owner} (duplicate_link)`
      );
    } else {
      linkNames.set(link.name, change.id);
    }
    const changesPrefix = `${WORKSPACE_DIR}/${CHANGES_DIR}/`;
    const archivePrefix = `${WORKSPACE_DIR}/${CHANGES_DIR}/${ARCHIVE_DIR}/`;
    if (link.active_path !== null) {
      const value = link.active_path.replace(/\\/g, '/');
      if (value.includes('\0') || value.split('/').includes('..') || path.isAbsolute(value)) {
        error(`changes.${change.id}.link.active_path`, `path inseguro: ${link.active_path}`);
      } else if (!value.startsWith(changesPrefix) || value.startsWith(archivePrefix)) {
        error(`changes.${change.id}.link.active_path`, `deve estar sob ${changesPrefix}`);
      }
    }
    if (link.archive_path !== null) {
      const value = link.archive_path.replace(/\\/g, '/');
      if (value.includes('\0') || value.split('/').includes('..') || path.isAbsolute(value)) {
        error(`changes.${change.id}.link.archive_path`, `path inseguro: ${link.archive_path}`);
      } else if (!value.startsWith(archivePrefix)) {
        error(`changes.${change.id}.link.archive_path`, `deve estar sob ${archivePrefix}`);
      }
    }

    // oversized_change: the linked change carries more than 10 deltas
    const linkedDir = link.archive_path
      ? path.join(ctx.projectRoot, link.archive_path)
      : link.active_path
        ? path.join(ctx.projectRoot, link.active_path)
        : path.join(ctx.projectRoot, WORKSPACE_DIR, CHANGES_DIR, link.name);
    if (await pathExists(linkedDir)) {
      const deltas = await readDeltaSpecs(linkedDir);
      const total = deltas.reduce((count, delta) => count + delta.entries.length, 0);
      if (total > MAX_DELTAS_PER_CHANGE) {
        warn(
          `changes.${change.id}.link`,
          `a change "${link.name}" tem ${total} deltas (oversized_change; limite ${MAX_DELTAS_PER_CHANGE})`
        );
      }
    }

    // ambiguous_archive_match: more than one archive directory fits the slug
    const candidates = await archiveCandidates(ctx.projectRoot, link.name);
    if (candidates.length > 1) {
      warn(
        `changes.${change.id}.link`,
        `mais de um archive candidato para "${link.name}": ${candidates.join(', ')} (ambiguous_archive_match)`
      );
    }
  }

  // Milestones
  const milestoneIds = new Set<string>();
  const orders = new Set<number>();
  for (const milestone of manifest.milestones) {
    if (milestoneIds.has(milestone.id)) {
      error(`milestones.${milestone.id}`, `id de milestone "${milestone.id}" está duplicado`);
    }
    milestoneIds.add(milestone.id);
    if (orders.has(milestone.order)) {
      error(`milestones.${milestone.id}.order`, `order ${milestone.order} está duplicado`);
    }
    orders.add(milestone.order);

    const seen = new Set<string>();
    for (const memberId of milestone.changes) {
      if (seen.has(memberId)) {
        error(`milestones.${milestone.id}.changes`, `${memberId} aparece duas vezes no milestone`);
      }
      seen.add(memberId);
      if (!ids.has(memberId)) {
        error(`milestones.${milestone.id}.changes`, `${memberId} não é um incremento do plano`);
      }
    }
  }
  for (const change of manifest.changes) {
    if (change.milestone === null) continue;
    if (!milestoneIds.has(change.milestone)) {
      error(`changes.${change.id}.milestone`, `milestone "${change.milestone}" não existe`);
      continue;
    }
    const milestone = manifest.milestones.find((candidate) => candidate.id === change.milestone)!;
    if (!milestone.changes.includes(change.id)) {
      error(
        `changes.${change.id}.milestone`,
        `${change.id} declara milestone ${change.milestone}, mas ${change.milestone} não o lista`
      );
    }
  }
  for (const milestone of manifest.milestones) {
    for (const memberId of milestone.changes) {
      const member = manifest.changes.find((candidate) => candidate.id === memberId);
      if (member && member.milestone !== milestone.id) {
        error(
          `milestones.${milestone.id}.changes`,
          `${milestone.id} lista ${memberId}, mas ${memberId} declara milestone ${member.milestone ?? 'null'}`
        );
      }
    }
  }

  // Documents present
  if (manifest.changes.length > 0) {
    if (!(await pathExists(ctx.paths.planDoc))) {
      warn('plan.md', 'plan.md está ausente (missing_document)');
    }
    if (!(await pathExists(ctx.paths.architecture))) {
      warn('architecture.md', 'architecture.md está ausente (missing_document)');
    }
  }

  // draft with materialized increments
  if (manifest.status === 'draft' && manifest.changes.some((change) => change.planned_change)) {
    warn('status', 'plano em draft já tem Planned Changes materializados');
  }

  // high fan-out: more than five direct dependents
  const directDependents = new Map<string, number>();
  for (const change of manifest.changes) {
    for (const dependency of change.depends_on) {
      directDependents.set(dependency, (directDependents.get(dependency) ?? 0) + 1);
    }
  }
  for (const [id, count] of directDependents) {
    if (count > 5) {
      warn(`changes.${id}.depends_on`, `${id} tem ${count} dependentes diretos (high_fanout_change)`);
    }
  }

  // partial write: a staging directory left on disk
  try {
    const remnants = (await fs.readdir(ctx.paths.dir)).filter((name) => name.startsWith('.tmp-'));
    if (remnants.length > 0) {
      warn(
        '.',
        `staging remanescente no disco: ${remnants.join(', ')} — rode git restore planning/ (partial_write_detected)`
      );
    }
  } catch {
    /* plan dir unreadable is caught elsewhere */
  }

  // an active change with a proposal and no link in the plan
  const linkedNames = new Set(
    manifest.changes.filter((change) => change.link).map((change) => change.link!.name)
  );
  try {
    const activeChanges = (await fs.readdir(path.join(ctx.projectRoot, WORKSPACE_DIR, CHANGES_DIR), {
      withFileTypes: true,
    }))
      .filter((entry) => entry.isDirectory() && entry.name !== ARCHIVE_DIR)
      .map((entry) => entry.name);
    for (const name of activeChanges.sort()) {
      if (linkedNames.has(name)) continue;
      if (await pathExists(path.join(ctx.projectRoot, WORKSPACE_DIR, CHANGES_DIR, name, 'proposal.md'))) {
        warn(`link`, `a change ativa "${name}" tem proposta e não está vinculada (unlinked_active_change)`);
      }
    }
  } catch {
    /* no spec/changes yet */
  }

  // Orphan Planned Change files
  const referenced = new Set(
    manifest.changes
      .filter((change) => change.planned_change)
      .map((change) => plannedChangeFileName(change.id, change.slug))
  );
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(ctx.paths.plannedChangesDir)).filter((name) => name.endsWith('.md'));
  } catch {
    entries = [];
  }
  for (const name of entries.sort()) {
    if (!referenced.has(name)) {
      warn(`${PLANNED_CHANGES_DIR}/${name}`, `arquivo sem registro no manifesto (orphan_planned_change)`);
    }
  }
}

/**
 * Validates a Planned Change BODY against §7.3, with no filesystem access, so
 * the same rules can run on a proposed tree that has not been written yet.
 */
export function validatePlannedChangeContent(
  content: string,
  record: { id: string; slug: string },
  relative: string,
  options: { strict?: boolean } = {}
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const parsed = parsePlannedChange(content);

  if (!parsed.frontmatter) {
    issues.push({
      level: 'ERROR',
      path: relative,
      message: parsed.frontmatterError ?? 'frontmatter inválido',
    });
  } else {
    if (parsed.frontmatter.id !== record.id) {
      issues.push({
        level: 'ERROR',
        path: `${relative}:id`,
        message: `frontmatter id "${parsed.frontmatter.id}" diverge do manifesto "${record.id}"`,
      });
    }
    if (parsed.frontmatter.slug !== record.slug) {
      issues.push({
        level: 'ERROR',
        path: `${relative}:slug`,
        message: `frontmatter slug "${parsed.frontmatter.slug}" diverge do manifesto "${record.slug}"`,
      });
    }
  }

  for (const heading of REQUIRED_PLANNED_CHANGE_SECTIONS) {
    if (!sectionHasText(parsed.sections, heading)) {
      issues.push({
        level: 'ERROR',
        path: `${relative}:${heading}`,
        message: `a seção "# ${heading}" está ausente ou vazia`,
      });
    }
  }

  for (const heading of parsed.deltaHeaders) {
    issues.push({
      level: 'ERROR',
      path: `${relative}:${heading}`,
      message: `Planned Change não pode conter cabeçalho de delta ("${heading}")`,
    });
  }

  if (options.strict) {
    for (const heading of OPTIONAL_STRICT_SECTIONS) {
      if (!sectionHasText(parsed.sections, heading)) {
        issues.push({
          level: 'WARNING',
          path: `${relative}:${heading}`,
          message: `a seção "# ${heading}" está ausente ou vazia`,
        });
      }
    }
  }

  return issues;
}

async function validatePlannedChange(
  ctx: Ctx,
  manifest: PlanManifest,
  change: ProjectChange
): Promise<ValidationReport> {
  const ref = change.planned_change!;
  const issues: ValidationIssue[] = [];
  const filePath = path.join(ctx.paths.dir, ref.path);
  const relative = ref.path;

  const content = ctx.briefs?.get(relative) ?? (await readFileIfExists(filePath));
  if (content === undefined) {
    issues.push({ level: 'ERROR', path: relative, message: 'arquivo não encontrado no disco' });
    return buildReport(change.id, 'planned-change', issues, ctx.strict);
  }

  const parsed = parsePlannedChange(content);

  if (!parsed.frontmatter) {
    issues.push({ level: 'ERROR', path: relative, message: parsed.frontmatterError ?? 'frontmatter inválido' });
  } else {
    const front = parsed.frontmatter;
    if (front.id !== change.id) {
      issues.push({
        level: 'ERROR',
        path: `${relative}:id`,
        message: `frontmatter id "${front.id}" diverge do manifesto "${change.id}"`,
      });
    }
    if (front.slug !== change.slug) {
      issues.push({
        level: 'ERROR',
        path: `${relative}:slug`,
        message: `frontmatter slug "${front.slug}" diverge do manifesto "${change.slug}"`,
      });
    }
  }

  const actualName = path.basename(filePath);
  const expectedName = plannedChangeFileName(change.id, change.slug);
  if (actualName !== expectedName) {
    issues.push({
      level: 'ERROR',
      path: relative,
      message: `nome do arquivo deveria ser "${expectedName}"`,
    });
  }

  for (const heading of REQUIRED_PLANNED_CHANGE_SECTIONS) {
    if (!sectionHasText(parsed.sections, heading)) {
      issues.push({
        level: 'ERROR',
        path: `${relative}:${heading}`,
        message: `a seção "# ${heading}" está ausente ou vazia`,
      });
    }
  }

  for (const heading of parsed.deltaHeaders) {
    issues.push({
      level: 'ERROR',
      path: `${relative}:${heading}`,
      message: `Planned Change não pode conter cabeçalho de delta ("${heading}")`,
    });
  }

  for (const heading of OPTIONAL_STRICT_SECTIONS) {
    if (!sectionHasText(parsed.sections, heading)) {
      issues.push({
        level: 'WARNING',
        path: `${relative}:${heading}`,
        message: `a seção "# ${heading}" está ausente ou vazia`,
      });
    }
  }

  // provenance: content edited by hand / source drift
  const sources: HashableSource[] = [];
  for (const source of manifest.source_documents) {
    let absolute: string;
    try {
      absolute = resolveWithinRoot(ctx.projectRoot, source.path, 'unsafe_source_path');
    } catch {
      sources.push({ path: source.path, content: undefined });
      continue;
    }
    sources.push({ path: source.path, content: await readFileIfExists(absolute) });
  }
  if (sha256(content) !== ref.content_hash && change.planning_state === 'planned') {
    issues.push({
      level: 'WARNING',
      path: relative,
      message: 'o arquivo foi editado desde a última materialização (modified)',
    });
  } else if (sourceHash(sources) !== ref.source_hash && change.planning_state === 'planned') {
    issues.push({
      level: 'WARNING',
      path: relative,
      message: 'a fonte mudou desde a materialização (outdated)',
    });
  }

  return buildReport(change.id, 'planned-change', issues, ctx.strict);
}

async function archiveCandidates(projectRoot: string, name: string): Promise<string[]> {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escaped}(-\\d+)?$`);
  const base = path.join(projectRoot, WORKSPACE_DIR, CHANGES_DIR, ARCHIVE_DIR);
  try {
    return (await fs.readdir(base, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
