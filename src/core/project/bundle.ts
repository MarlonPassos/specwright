import { z } from 'zod';
import { SpecError } from '../../util/errors.js';
import { localDateStamp } from '../../util/date.js';
import {
  nextChangeId,
  type Milestone,
  type PlanManifest,
  type Priority,
  type ProjectChange,
} from './model.js';
import { ProjectGraph } from './graph.js';
import { plannedChangeRelPath, resolveWithinRoot } from './paths.js';
import { renderPlannedChange, type RenderPlannedChangeInput } from './planned-change.js';

export const BUNDLE_VERSION = 1;

const bulletList = z.array(z.string().min(1));

const PlannedChangeSpecSchema = z
  .object({
    objetivo: z.string().min(1).optional(),
    motivacao: z.string().min(1).optional(),
    escopo: bulletList.optional(),
    foraDoEscopo: bulletList.optional(),
    criteriosMacro: bulletList.optional(),
    riscos: bulletList.optional(),
    notas: bulletList.optional(),
    referencias: bulletList.optional(),
    readiness: z.string().min(1).optional(),
  })
  .strict();
export type PlannedChangeSpec = z.infer<typeof PlannedChangeSpecSchema>;

// Every slug in the system is kebab-case, so `$bug-fixes` is the ref an author
// reaches for first. Forbidding `-` here turned that instinct into a wall of
// `ref: Invalid` with nothing saying which character was the problem.
const REF_MESSAGE = 'um ref é "$nome" com letras, dígitos, "_" ou "-" (ex.: "$bug-fixes")';
const ref = z.string().regex(/^\$[A-Za-z0-9_-]+$/, REF_MESSAGE);
// A union reports "Invalid" for the whole thing; one regex reports what it wants.
const idOrRef = z
  .string()
  .regex(
    /^(?:CH-\d{3,}|\$[A-Za-z0-9_-]+)$/,
    'use um id "CH-NNN" já existente ou um ref "$nome" declarado antes neste bundle'
  );

export const OperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('addChange'),
    ref: ref.optional(),
    slug: z.string().min(1),
    title: z.string().min(1),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    dependsOn: z.array(idOrRef).optional(),
    milestone: z.string().min(1).nullable().optional(),
    plannedChange: PlannedChangeSpecSchema.optional(),
  }).strict(),
  z.object({
    op: z.literal('updateChange'),
    id: z.string(),
    set: z.object({ priority: z.enum(['critical', 'high', 'medium', 'low']).optional(), title: z.string().min(1).optional() }).strict(),
  }).strict(),
  z.object({ op: z.literal('setDependencies'), id: z.string(), dependsOn: z.array(idOrRef) }).strict(),
  z.object({ op: z.literal('setBlockers'), id: z.string(), manualBlockers: z.array(z.string().min(1)) }).strict(),
  z.object({ op: z.literal('renameSlug'), id: z.string(), slug: z.string().min(1) }).strict(),
  z.object({ op: z.literal('replacePlannedChange'), id: z.string(), plannedChange: PlannedChangeSpecSchema }).strict(),
  z.object({
    op: z.literal('splitChange'),
    id: z.string(),
    into: z
      .array(
        z.object({
          ref: ref.optional(),
          slug: z.string().min(1),
          title: z.string().min(1),
          dependsOn: z.array(idOrRef).optional(),
          plannedChange: PlannedChangeSpecSchema.optional(),
        }).strict()
      )
      .min(2),
    rewire: z.record(z.string(), z.array(idOrRef)),
  }).strict(),
  z.object({
    op: z.literal('mergeChanges'),
    ids: z.array(z.string()).min(2),
    survivor: z.string(),
    plannedChange: PlannedChangeSpecSchema.optional(),
  }).strict(),
  z.object({
    op: z.literal('setMilestones'),
    milestones: z.array(
      z.object({ id: z.string(), name: z.string().min(1), order: z.number().int().min(1), changes: z.array(idOrRef) }).strict()
    ),
  }).strict(),
  z.object({ op: z.literal('writeDocument'), target: z.enum(['plan', 'architecture']), content: z.string() }).strict(),
]);

export const BundleSchema = z
  .object({
    bundleVersion: z.number().int(),
    expectRevision: z.number().int().nonnegative(),
    plan: z
      .object({
        name: z.string().min(1).optional(),
        status: z.enum(['draft', 'reviewing', 'active', 'paused', 'completed', 'archived']).optional(),
        summary: z.string().min(1).optional(),
        scope: z.object({ in: z.array(z.string()), out: z.array(z.string()) }).partial().optional(),
        sourceDocuments: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    operations: z.array(OperationSchema),
  })
  .strict();
export type Bundle = z.infer<typeof BundleSchema>;

export interface PendingBrief {
  id: string;
  slug: string;
  /** Rendered body, or undefined to render a skeleton at write time. */
  spec?: PlannedChangeSpec;
}

export interface DocumentWrite {
  target: 'plan' | 'architecture';
  content: string;
}

export interface BundleResult {
  manifest: PlanManifest;
  idMap: Record<string, string>;
  /** Briefs to (re)write, keyed by increment id. */
  pendingBriefs: PendingBrief[];
  /** Brief files to delete (old path after a slug rename). */
  briefRenames: Array<{ from: string; to: string }>;
  documents: DocumentWrite[];
  /** Increment ids whose record changed and now touch a completed increment. */
  completedTouched: string[];
}

export interface ApplyContext {
  /** Project root, so persisted paths can be checked against it before writing. */
  projectRoot?: string;
  archivedIds: Set<string>;
  allowCompleted: boolean;
  /**
   * `--dry-run`. A preview REPORTS what it would touch instead of throwing:
   * the §7.11 pipeline puts the completed-increment check after the dry-run
   * fork, and a preview that blows up hides exactly the information the user
   * needs to decide whether to pass `--allow-completed` (A-07).
   */
  previewOnly?: boolean;
  resolveSourceHash: (path: string) => string | undefined;
  now?: Date;
}

/** Parses a bundle, throwing `invalid_bundle` / `unsupported_bundle_version`. */
export function parseBundle(raw: unknown): Bundle {
  const result = BundleSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new SpecError(`Bundle inválido: ${detail}`, {
      code: 'invalid_bundle',
      fix: 'specs project bundle-schema --json',
    });
  }
  if (result.data.bundleVersion !== BUNDLE_VERSION) {
    throw new SpecError(
      `bundleVersion ${result.data.bundleVersion} não é suportado (esperado ${BUNDLE_VERSION}).`,
      { code: 'unsupported_bundle_version', fix: 'specs project bundle-schema --json' }
    );
  }
  return result.data;
}

/**
 * Applies a bundle to a manifest in memory and returns the proposed state plus
 * everything the caller must write. Never touches disk. Every failure is
 * pre-write.
 */
export function applyBundle(
  manifest: PlanManifest,
  bundle: Bundle,
  ctx: ApplyContext
): BundleResult {
  if (bundle.expectRevision !== manifest.revision) {
    throw new SpecError(
      `A revisão no disco é ${manifest.revision}, mas o bundle esperava ${bundle.expectRevision}.`,
      { code: 'plan_revision_conflict', fix: 'specs project status --json' }
    );
  }

  const working: PlanManifest = structuredClone(manifest);
  const idMap: Record<string, string> = {};
  const pendingBriefs: PendingBrief[] = [];
  const briefRenames: Array<{ from: string; to: string }> = [];
  const documents: DocumentWrite[] = [];
  const completedTouched = new Set<string>();

  const allIds = () => new Set(working.changes.map((c) => c.id));
  const find = (id: string): ProjectChange => {
    const resolved = idMap[id] ?? id;
    const change = working.changes.find((c) => c.id === resolved);
    if (!change) {
      throw new SpecError(`O incremento ${id} não existe no plano.`, { code: 'change_not_found' });
    }
    return change;
  };
  const resolveRef = (token: string): string => {
    if (token.startsWith('$')) {
      const mapped = idMap[token];
      if (!mapped)
        throw new SpecError(`ref desconhecido: ${token}`, {
          code: 'unknown_ref',
          fix: 'Um ref precisa ser declarado por um addChange/splitChange ANTES da operação que o cita. Contrato: specs project bundle-schema',
        });
      return mapped;
    }
    if (!allIds().has(token)) {
      // An assistant that predicts CH-NNN for an increment the same bundle is
      // creating lands here. Name the `$ref` mechanism so the next attempt is
      // informed instead of another guess.
      throw new SpecError(
        `${token} não é um incremento do plano.`,
        {
          code: 'unknown_dependency',
          fix: 'Para citar um incremento que este mesmo bundle cria, declare `ref: "$nome"` no addChange/splitChange e use "$nome" aqui — nunca um CH-NNN previsto. Contrato completo: specs project bundle-schema',
        }
      );
    }
    return token;
  };
  const allocated: string[] = [];
  const allocate = (token: string | undefined): string => {
    // nextChangeId only sees committed records, so track pending ids too.
    let candidate = nextChangeId(working.changes);
    while (allocated.includes(candidate)) {
      candidate = `CH-${String(Number(candidate.slice(3)) + 1).padStart(3, '0')}`;
    }
    allocated.push(candidate);
    if (token) idMap[token] = candidate;
    return candidate;
  };

  // Plan-level fields
  if (bundle.plan) {
    const plan = bundle.plan;
    working.name = plan.name ?? working.name;
    working.status = plan.status ?? working.status;
    if (plan.summary !== undefined) working.summary = plan.summary;
    if (plan.scope) working.scope = { in: plan.scope.in ?? [], out: plan.scope.out ?? [] };
    if (plan.sourceDocuments) {
      // FR-06: persist only the POSIX form, normalised once here so the hash,
      // the resolution and the manifest all agree across platforms.
      working.source_documents = plan.sourceDocuments.map((declared) => {
        const normalised = declared.replace(/\\/g, '/');
        return {
          path: normalised,
          sha256: ctx.resolveSourceHash(declared) ?? ctx.resolveSourceHash(normalised) ?? '',
        };
      });
    }
  }

  const blankRecord = (id: string, slug: string, title: string): ProjectChange => ({
    id,
    slug,
    title,
    planning_state: 'planned',
    priority: 'medium',
    depends_on: [],
    manual_blockers: [],
    superseded_by: [],
    milestone: null,
    planned_change: null,
    link: null,
  });

  for (const operation of bundle.operations) {
    switch (operation.op) {
      case 'addChange': {
        const id = allocate(operation.ref);
        const record = blankRecord(id, operation.slug, operation.title);
        if (operation.priority) record.priority = operation.priority as Priority;
        if (operation.milestone !== undefined) record.milestone = operation.milestone;
        record.depends_on = (operation.dependsOn ?? []).map(resolveRef);
        working.changes.push(record);
        if (operation.plannedChange) {
          record.planned_change = pendingRef(id, operation.slug, working.revision + 1);
          pendingBriefs.push({ id, slug: operation.slug, spec: operation.plannedChange });
        }
        break;
      }
      case 'updateChange': {
        const change = find(operation.id);
        if (operation.set.priority) change.priority = operation.set.priority as Priority;
        if (operation.set.title) change.title = operation.set.title;
        break;
      }
      case 'setDependencies': {
        const change = find(operation.id);
        change.depends_on = operation.dependsOn.map(resolveRef);
        break;
      }
      case 'setBlockers': {
        const change = find(operation.id);
        change.manual_blockers = [...operation.manualBlockers];
        break;
      }
      case 'renameSlug': {
        const change = find(operation.id);
        if (change.planned_change) {
          const from = change.planned_change.path;
          const to = plannedChangeRelPath(change.id, operation.slug);
          briefRenames.push({ from, to });
          change.planned_change = { ...change.planned_change, path: to };
        }
        change.slug = operation.slug;
        break;
      }
      case 'replacePlannedChange': {
        const change = find(operation.id);
        change.planned_change = pendingRef(change.id, change.slug, working.revision + 1);
        pendingBriefs.push({ id: change.id, slug: change.slug, spec: operation.plannedChange });
        break;
      }
      case 'splitChange': {
        const original = find(operation.id);
        const dependents = new Set(
          working.changes.filter((c) => c.depends_on.includes(original.id)).map((c) => c.id)
        );
        const newIds: string[] = [];
        for (const entry of operation.into) {
          const id = allocate(entry.ref);
          newIds.push(id);
          const record = blankRecord(id, entry.slug, entry.title);
          record.depends_on = (entry.dependsOn ?? []).map(resolveRef);
          working.changes.push(record);
          if (entry.plannedChange) {
            record.planned_change = pendingRef(id, entry.slug, working.revision + 1);
            pendingBriefs.push({ id, slug: entry.slug, spec: entry.plannedChange });
          }
        }
        for (const dependentId of dependents) {
          const mapped = operation.rewire[dependentId];
          if (!mapped) {
            throw new SpecError(
              `splitChange não mapeou o dependente ${dependentId} em rewire.`,
              { code: 'unmapped_dependents' }
            );
          }
          const dependent = working.changes.find((c) => c.id === dependentId)!;
          dependent.depends_on = [
            ...dependent.depends_on.filter((d) => d !== original.id),
            ...mapped.map(resolveRef),
          ];
        }
        original.planning_state = 'cancelled';
        original.superseded_by = newIds;
        break;
      }
      case 'mergeChanges': {
        if (!operation.ids.includes(operation.survivor)) {
          throw new SpecError('mergeChanges exige survivor entre ids.', { code: 'invalid_bundle' });
        }
        for (const id of operation.ids) {
          if (ctx.archivedIds.has(idMap[id] ?? id)) {
            throw new SpecError(`mergeChanges não pode incluir ${id}, que está concluído.`, {
              code: 'merge_completed_change',
            });
          }
        }
        const survivor = find(operation.survivor);
        const mergedIds = operation.ids.filter((id) => (idMap[id] ?? id) !== survivor.id).map((id) => idMap[id] ?? id);
        const absorbed = new Set(survivor.depends_on);
        for (const mergedId of mergedIds) {
          const merged = working.changes.find((c) => c.id === mergedId)!;
          merged.depends_on.forEach((d) => absorbed.add(d));
          merged.planning_state = 'cancelled';
          merged.superseded_by = [survivor.id];
        }
        survivor.depends_on = [...absorbed].filter(
          (d) => d !== survivor.id && !mergedIds.includes(d)
        );
        for (const change of working.changes) {
          if (mergedIds.some((m) => change.depends_on.includes(m))) {
            change.depends_on = [
              ...new Set(change.depends_on.map((d) => (mergedIds.includes(d) ? survivor.id : d))),
            ].filter((d) => d !== change.id);
          }
        }
        if (operation.plannedChange) {
          survivor.planned_change = pendingRef(survivor.id, survivor.slug, working.revision + 1);
          pendingBriefs.push({ id: survivor.id, slug: survivor.slug, spec: operation.plannedChange });
        }
        break;
      }
      case 'setMilestones': {
        const milestones: Milestone[] = operation.milestones.map((m) => ({
          id: m.id,
          name: m.name,
          order: m.order,
          changes: m.changes.map(resolveRef),
        }));
        working.milestones = milestones;
        const membership = new Map<string, string>();
        for (const milestone of milestones) {
          for (const memberId of milestone.changes) membership.set(memberId, milestone.id);
        }
        for (const change of working.changes) {
          change.milestone = membership.get(change.id) ?? null;
        }
        break;
      }
      case 'writeDocument': {
        documents.push({ target: operation.target, content: operation.content });
        break;
      }
      default: {
        throw new SpecError(`Operação desconhecida: ${(operation as { op: string }).op}`, {
          code: 'unknown_operation',
        });
      }
    }
  }

  // ONE completed-increment guard, over the real diff.
  //
  // The guard used to sit inside each `case`, keyed on the id the operation
  // NAMES. Composite operations mutate records they do not name — `setMilestones`
  // reassigns every increment's milestone, `splitChange` and `mergeChanges`
  // rewrite the `depends_on` of dependents — so all three walked straight past
  // `--allow-completed` and rewrote archived history without asking (F-05).
  // §7.11 rule 6 says "reaches", not "names".
  //
  // Comparing records rather than collecting ids touched by the loop is what
  // keeps this usable: a `setMilestones` that reassigns the same milestone to a
  // completed increment changes nothing and must not demand a flag.
  const completed = touchedChangeIds(manifest, working).filter((id) => ctx.archivedIds.has(id));
  if (completed.length > 0) {
    if (!ctx.allowCompleted && ctx.previewOnly !== true) {
      throw new SpecError(
        `A operação atinge ${completed.join(', ')}, que está concluído.`,
        { code: 'completed_change_protected', fix: 'specs project apply --allow-completed' }
      );
    }
    for (const id of completed) completedTouched.add(id);
  }

  // Proposed state must be a DAG, and structurally valid, BEFORE any write.
  ProjectGraph.from(working.changes);
  assertProposedStateValid(working, ctx.projectRoot);

  working.revision = manifest.revision + 1;
  working.updated_at = localDateStamp(ctx.now ?? new Date());

  return {
    manifest: working,
    idMap,
    pendingBriefs,
    briefRenames,
    documents,
    completedTouched: [...completedTouched],
  };
}

/**
 * Ids whose persisted record differs between two manifests, in the order the
 * first manifest declares them.
 *
 * Every field a plan file carries for an increment is compared, because any of
 * them is a mutation of the record: `depends_on` as an ordered SET, the way
 * `recordHash` already treats it, so a reordering that means nothing is not
 * reported as a change. An id present in `before` and gone from `after` counts
 * as touched.
 */
export function touchedChangeIds(before: PlanManifest, after: PlanManifest): string[] {
  const afterById = new Map(after.changes.map((change) => [change.id, change]));
  const touched: string[] = [];
  for (const previous of before.changes) {
    const next = afterById.get(previous.id);
    if (next === undefined || !sameRecord(previous, next)) touched.push(previous.id);
  }
  return touched;
}

function sameRecord(a: ProjectChange, b: ProjectChange): boolean {
  return (
    a.slug === b.slug &&
    a.title === b.title &&
    a.planning_state === b.planning_state &&
    a.priority === b.priority &&
    a.milestone === b.milestone &&
    (a.reason ?? null) === (b.reason ?? null) &&
    sameSet(a.depends_on, b.depends_on) &&
    sameList(a.manual_blockers, b.manual_blockers) &&
    sameList(a.superseded_by, b.superseded_by) &&
    samePlannedChange(a.planned_change, b.planned_change) &&
    sameLink(a.link, b.link)
  );
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return sameList([...a].sort(), [...b].sort());
}

function samePlannedChange(
  a: ProjectChange['planned_change'],
  b: ProjectChange['planned_change']
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.path === b.path &&
    a.generated_from_plan_revision === b.generated_from_plan_revision &&
    a.source_hash === b.source_hash &&
    a.content_hash === b.content_hash &&
    (a.record_hash ?? null) === (b.record_hash ?? null)
  );
}

function sameLink(a: ProjectChange['link'], b: ProjectChange['link']): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.name === b.name &&
    a.active_path === b.active_path &&
    a.archive_path === b.archive_path &&
    a.linked_at === b.linked_at
  );
}

const KEBAB_SLUG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * The §7.17 ERROR rules a bundle can violate that `ProjectGraph.from` does not
 * already cover: slug shape, `superseded_by` targets, and the two-way
 * increment ↔ milestone consistency. Failing here means nothing is written.
 */
export function assertProposedStateValid(manifest: PlanManifest, projectRoot?: string): void {
  const ids = new Set(manifest.changes.map((change) => change.id));

  for (const change of manifest.changes) {
    if (!KEBAB_SLUG.test(change.slug)) {
      throw new SpecError(`O slug "${change.slug}" de ${change.id} não é kebab-case.`, {
        code: 'plan_invalid',
      });
    }
    for (const superseded of change.superseded_by) {
      if (!ids.has(superseded)) {
        throw new SpecError(`${change.id}.superseded_by cita ${superseded}, que o plano não declara.`, {
          code: 'plan_invalid',
        });
      }
    }
  }

  // Every persisted path must be safe and relative, in the proposed state, before
  // a single byte is written (FR-06, NFR-08, I-8).
  for (let index = 0; index < manifest.source_documents.length; index += 1) {
    const source = manifest.source_documents[index];
    try {
      resolveWithinRoot(projectRoot ?? '.', source.path, 'unsafe_source_path');
    } catch (error) {
      throw new SpecError(
        `source_documents[${index}].path é inseguro: ${(error as Error).message}`,
        { code: 'unsafe_source_path' }
      );
    }
    if (!source.sha256) {
      throw new SpecError(
        `source_documents[${index}] ("${source.path}") não pôde ser lido; nenhum sha256 foi calculado.`,
        { code: 'plan_invalid', fix: 'confira o caminho do documento-fonte' }
      );
    }
  }
  for (const change of manifest.changes) {
    const ref = change.planned_change;
    if (!ref) continue;
    const expected = plannedChangeRelPath(change.id, change.slug);
    if (ref.path !== expected) {
      throw new SpecError(
        `planned_change.path de ${change.id} deveria ser "${expected}", mas é "${ref.path}".`,
        { code: 'unsafe_plan_path' }
      );
    }
  }

  const milestoneIds = new Set(manifest.milestones.map((m) => m.id));
  const orders = new Set<number>();
  for (const milestone of manifest.milestones) {
    if (orders.has(milestone.order)) {
      throw new SpecError(`order ${milestone.order} de milestone está duplicado.`, {
        code: 'plan_invalid',
      });
    }
    orders.add(milestone.order);
    for (const memberId of milestone.changes) {
      if (!ids.has(memberId)) {
        throw new SpecError(`Milestone ${milestone.id} lista ${memberId}, que não é um incremento.`, {
          code: 'plan_invalid',
        });
      }
      const member = manifest.changes.find((c) => c.id === memberId)!;
      if (member.milestone !== milestone.id) {
        throw new SpecError(
          `${milestone.id} lista ${memberId}, mas ${memberId} declara milestone ${member.milestone ?? 'null'}.`,
          { code: 'plan_invalid' }
        );
      }
    }
  }
  for (const change of manifest.changes) {
    if (change.milestone !== null) {
      if (!milestoneIds.has(change.milestone)) {
        throw new SpecError(`${change.id} declara milestone ${change.milestone}, que não existe.`, {
          code: 'plan_invalid',
        });
      }
      const milestone = manifest.milestones.find((m) => m.id === change.milestone)!;
      if (!milestone.changes.includes(change.id)) {
        throw new SpecError(
          `${change.id} declara milestone ${change.milestone}, mas ${change.milestone} não o lista.`,
          { code: 'plan_invalid' }
        );
      }
    }
  }
}

function pendingRef(id: string, slug: string, revision: number): ProjectChange['planned_change'] {
  return {
    path: plannedChangeRelPath(id, slug),
    generated_from_plan_revision: revision,
    source_hash: '',
    content_hash: '',
  };
}

/** Renders a brief body from a bundle's plannedChange spec. */
export function renderBriefFromSpec(
  id: string,
  slug: string,
  title: string,
  planRevision: number,
  spec: PlannedChangeSpec | undefined
): string {
  const sections: RenderPlannedChangeInput['sections'] = {};
  if (spec?.objetivo) sections.Objetivo = spec.objetivo;
  if (spec?.motivacao) sections['Motivação'] = spec.motivacao;
  if (spec?.escopo) sections.Escopo = spec.escopo.map((line) => `- ${line}`).join('\n');
  if (spec?.foraDoEscopo) sections['Fora do escopo'] = spec.foraDoEscopo.map((line) => `- ${line}`).join('\n');
  if (spec?.criteriosMacro) sections['Critérios macro'] = spec.criteriosMacro.map((line) => `- ${line}`).join('\n');
  if (spec?.riscos) sections.Riscos = spec.riscos.map((line) => `- ${line}`).join('\n');
  if (spec?.notas) sections['Notas para exploração'] = spec.notas.map((line) => `- ${line}`).join('\n');
  if (spec?.referencias) sections['Referências da fonte'] = spec.referencias.map((line) => `- ${line}`).join('\n');
  if (spec?.readiness) sections['Readiness e handoff'] = spec.readiness;
  return renderPlannedChange({ id, slug, title, planRevision, sections });
}
