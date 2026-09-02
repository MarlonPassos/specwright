import { stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

/** The only `plan.yaml` format this build understands. */
export const PLAN_SCHEMA_VERSION = 1;
/** The only Planned Change frontmatter version this build understands. */
export const PLANNED_CHANGE_SCHEMA_VERSION = 1;

/** A Project Change id: `CH-` and at least three digits. Immutable once allocated. */
export const CHANGE_ID_PATTERN = /^CH-\d{3,}$/;
const KEBAB_CASE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const DATE_STAMP = /^\d{4}-\d{2}-\d{2}$/;

export const PLANNING_STATES = ['idea', 'planned', 'on_hold', 'cancelled'] as const;
export type PlanningState = (typeof PLANNING_STATES)[number];

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PLAN_STATUSES = [
  'draft',
  'reviewing',
  'active',
  'paused',
  'completed',
  'archived',
] as const;
export type PlanStatusValue = (typeof PLAN_STATUSES)[number];

/** Derived, never persisted. */
export const MATERIALIZATION_STATES = ['current', 'outdated', 'modified', 'missing'] as const;
export type MaterializationState = (typeof MATERIALIZATION_STATES)[number];

const kebab = (label: string) =>
  z.string().regex(KEBAB_CASE, `${label} deve ser kebab-case: letras minúsculas, dígitos e hifens`);

const changeId = z.string().regex(CHANGE_ID_PATTERN, 'deve casar ^CH-\\d{3,}$');
const dateStamp = z.string().regex(DATE_STAMP, 'deve ser uma data YYYY-MM-DD');

export const SourceDocumentSchema = z
  .object({
    path: z.string().min(1),
    sha256: z.string().min(1),
  })
  .strict();
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;

export const PlannedChangeRefSchema = z
  .object({
    path: z.string().min(1),
    generated_from_plan_revision: z.number().int().nonnegative(),
    source_hash: z.string().min(1),
    content_hash: z.string().min(1),
    /**
     * Hash of the record fields that make a brief stale when they change
     * (slug, title, depends_on, milestone). Optional so plans written before
     * this field still load; absent means "cannot tell", not "current".
     */
    record_hash: z.string().min(1).optional(),
  })
  .strict();
export type PlannedChangeRef = z.infer<typeof PlannedChangeRefSchema>;

export const ChangeLinkSchema = z
  .object({
    name: kebab('link.name'),
    active_path: z.string().min(1).nullable(),
    archive_path: z.string().min(1).nullable(),
    linked_at: dateStamp,
  })
  .strict();
export type ChangeLink = z.infer<typeof ChangeLinkSchema>;

export const MilestoneSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    order: z.number().int().min(1),
    changes: z.array(changeId).default([]),
  })
  .strict();
export type Milestone = z.infer<typeof MilestoneSchema>;

export const ProjectChangeSchema = z
  .object({
    id: changeId,
    slug: kebab('slug'),
    title: z.string().min(1),
    planning_state: z.enum(PLANNING_STATES),
    priority: z.enum(PRIORITIES).default('medium'),
    depends_on: z.array(changeId).default([]),
    manual_blockers: z.array(z.string().min(1)).default([]),
    superseded_by: z.array(changeId).default([]),
    milestone: z.string().min(1).nullable(),
    /**
     * The motive recorded by the last `set-state` into `on_hold` or `cancelled`,
     * for auditability (§7.6). Cleared when the state returns to `planned`.
     * Optional so plans written before this field still load.
     */
    reason: z.string().min(1).optional(),
    planned_change: PlannedChangeRefSchema.nullable(),
    link: ChangeLinkSchema.nullable(),
  })
  .strict();
export type ProjectChange = z.infer<typeof ProjectChangeSchema>;

export const ScopeSchema = z
  .object({
    in: z.array(z.string().min(1)).default([]),
    out: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type Scope = z.infer<typeof ScopeSchema>;

export const PlanManifestSchema = z
  .object({
    schema_version: z.literal(PLAN_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    id: kebab('id'),
    name: z.string().min(1),
    status: z.enum(PLAN_STATUSES),
    owner: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    scope: ScopeSchema.optional(),
    created_at: dateStamp,
    updated_at: dateStamp,
    source_documents: z.array(SourceDocumentSchema).default([]),
    milestones: z.array(MilestoneSchema).default([]),
    changes: z.array(ProjectChangeSchema).default([]),
  })
  .strict();
export type PlanManifest = z.infer<typeof PlanManifestSchema>;

/**
 * The next free Project Change id: `max(N over every CH-N present) + 1`, at
 * least three digits. Cancelled ids count, so an id is never reused.
 */
export function nextChangeId(changes: ProjectChange[]): string {
  let highest = 0;
  for (const change of changes) {
    const match = /^CH-(\d+)$/.exec(change.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `CH-${String(highest + 1).padStart(3, '0')}`;
}

/** Formats a Zod issue as `path.to.field: message`. */
export function formatZodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

/**
 * Builds the manifest object in fixed key order and serializes it. The order is
 * the one in the field-contract tables of §7.2, so `load → save → load` is
 * byte-idempotent. `changes` keeps declaration order; `milestones` is sorted by
 * `order`. Optional fields that are absent are omitted; the required arrays and
 * the nullable objects are always explicit, so a Git diff shows intent.
 */
export function renderManifest(manifest: PlanManifest): string {
  const document: Record<string, unknown> = {
    schema_version: manifest.schema_version,
    revision: manifest.revision,
    id: manifest.id,
    name: manifest.name,
    status: manifest.status,
  };
  if (manifest.owner !== undefined) document.owner = manifest.owner;
  if (manifest.summary !== undefined) document.summary = manifest.summary;
  if (manifest.scope !== undefined) {
    document.scope = { in: [...manifest.scope.in], out: [...manifest.scope.out] };
  }
  document.created_at = manifest.created_at;
  document.updated_at = manifest.updated_at;
  document.source_documents = manifest.source_documents.map((source) => ({
    path: source.path,
    sha256: source.sha256,
  }));
  document.milestones = [...manifest.milestones]
    .sort((a, b) => a.order - b.order)
    .map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      order: milestone.order,
      changes: [...milestone.changes],
    }));
  document.changes = manifest.changes.map(renderChange);

  return stringifyYaml(document, { lineWidth: 0 });
}

function renderChange(change: ProjectChange): Record<string, unknown> {
  const document: Record<string, unknown> = {
    id: change.id,
    slug: change.slug,
    title: change.title,
    planning_state: change.planning_state,
    priority: change.priority,
    depends_on: [...change.depends_on],
    manual_blockers: [...change.manual_blockers],
    superseded_by: [...change.superseded_by],
    milestone: change.milestone,
  };
  if (change.reason !== undefined) document.reason = change.reason;
  return {
    ...document,
    planned_change: change.planned_change
      ? {
          path: change.planned_change.path,
          generated_from_plan_revision: change.planned_change.generated_from_plan_revision,
          source_hash: change.planned_change.source_hash,
          content_hash: change.planned_change.content_hash,
          ...(change.planned_change.record_hash !== undefined
            ? { record_hash: change.planned_change.record_hash }
            : {}),
        }
      : null,
    link: change.link
      ? {
          name: change.link.name,
          active_path: change.link.active_path,
          archive_path: change.link.archive_path,
          linked_at: change.link.linked_at,
        }
      : null,
  };
}
