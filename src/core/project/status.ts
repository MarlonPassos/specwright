import path from 'node:path';
import { SpecError } from '../../util/errors.js';
import { readFileIfExists } from '../../util/fs.js';
import { listChanges, listArchivedChanges, type Workspace } from '../workspace.js';
import { loadPlan } from './repository.js';
import { ProjectGraph } from './graph.js';
import { parsePlannedChange } from './planned-change.js';
import { validatePlannedChangeContent } from './validate.js';
import { safeResolve } from './paths.js';
import { readEvidence } from './evidence.js';
import { sha256, sourceHash, type HashableSource } from './hashes.js';
import { resolveWithinRoot } from './paths.js';
import {
  executionOf,
  materializationState,
  presentationOf,
  readinessOf,
  type Execution,
  type Readiness,
} from './state.js';
import type { PlanManifest, MaterializationState, PlanStatusValue as DeclaredStatus } from './model.js';
import type { RoadmapRow } from './render.js';

export interface PlannedChangeView {
  path: string;
  state: MaterializationState;
  generatedFromPlanRevision: number;
}

export interface LinkView {
  name: string;
  activePath: string | null;
  archivePath: string | null;
  tasks: { total: number; completed: number } | null;
}

export interface ProjectChangeView {
  id: string;
  slug: string;
  title: string;
  planningState: string;
  readiness: Readiness;
  readinessReasons: string[];
  execution: Execution;
  executionEvidence: string[];
  presentation: string;
  priority: string;
  milestone: string | null;
  dependsOn: string[];
  blockedBy: string[];
  manualBlockers: string[];
  unlocks: string[];
  supersededBy: string[];
  plannedChange: PlannedChangeView | null;
  link: LinkView | null;
}

export interface DiagnosticView {
  level: 'ERROR' | 'WARNING' | 'INFO';
  code: string;
  path: string;
  message: string;
  fix?: string;
}

export type DerivedStatus = DeclaredStatus | 'active';

export interface MilestoneView {
  id: string;
  name: string;
  order: number;
  changes: string[];
  archived: number;
  total: number;
  derivedStatus: 'not_started' | 'in_progress' | 'completed';
}

export interface PlanStatus {
  plan: {
    id: string;
    name: string;
    path: string;
    revision: number;
    status: DeclaredStatus;
    derivedStatus: DerivedStatus;
    owner?: string;
    updatedAt: string;
  };
  workspace: string;
  progress: {
    total: number;
    archived: number;
    ready: number;
    blocked: number;
    inProgress: number;
    idea: number;
    onHold: number;
    cancelled: number;
    percent: number;
  };
  changes: ProjectChangeView[];
  milestones: MilestoneView[];
  diagnostics: DiagnosticView[];
  /** The DAG, kept for `next` so it does not rebuild it. */
  graph: ProjectGraph;
  /** Change directory names present in the workspace, active and archived. */
  workspaceChanges: { active: Set<string>; archivedSlugs: Set<string> };
  manifest: PlanManifest;
}

export async function computeProjectStatus(
  workspace: Workspace,
  id: string
): Promise<PlanStatus> {
  const { manifest, paths } = await loadPlan(workspace.projectRoot, id);
  const graph = ProjectGraph.from(manifest.changes);
  const order = graph.order();

  // Sources → current hash, shared by every brief in the MVP.
  const sources: HashableSource[] = [];
  let anySourceMissing = false;
  let anySourceChanged = false;
  for (const source of manifest.source_documents) {
    let content: string | undefined;
    try {
      content = await readFileIfExists(resolveWithinRoot(workspace.projectRoot, source.path, 'unsafe_source_path'));
    } catch {
      content = undefined;
    }
    if (content === undefined) anySourceMissing = true;
    else if (sha256(content) !== source.sha256) anySourceChanged = true;
    sources.push({ path: source.path, content });
  }
  const currentSourceHash = sourceHash(sources);

  const byId = new Map(manifest.changes.map((change) => [change.id, change]));

  // Materialization
  const materialization = new Map<string, MaterializationState>();
  const briefRevision = new Map<string, number>();
  /** Increments whose brief exists but does not satisfy §7.3. */
  const invalidBrief = new Map<string, string[]>();
  for (const change of manifest.changes) {
    const ref = change.planned_change;
    if (!ref) {
      materialization.set(change.id, 'missing');
      continue;
    }
    // A persisted path is untrusted input: a `..` must fail the read closed,
    // never leak a file from outside the plan directory (I-8, NFR-08).
    const briefAbsolute = safeResolve(paths.dir, ref.path);
    const briefContent =
      briefAbsolute === undefined ? undefined : await readFileIfExists(briefAbsolute);
    materialization.set(
      change.id,
      materializationState({
        change,
        briefContent,
        briefContentSha: briefContent === undefined ? undefined : sha256(briefContent),
        currentSourceHash,
      })
    );
    briefRevision.set(change.id, ref.generated_from_plan_revision);

    // A matching hash proves the bytes are the ones recorded; it does NOT prove
    // the document is structurally valid. Without this an invalid brief read as
    // `current` and the increment as `ready` (FR-22).
    if (briefContent !== undefined) {
      const issues = validatePlannedChangeContent(
        briefContent,
        { id: change.id, slug: change.slug },
        ref.path
      ).filter((issue) => issue.level === 'ERROR');
      if (issues.length > 0) invalidBrief.set(change.id, issues.map((issue) => issue.message));
    }
  }

  // Execution — independent of other changes
  const execution = new Map<string, Execution>();
  const executionEvidence = new Map<string, string[]>();
  const linkTasks = new Map<string, { total: number; completed: number } | null>();
  const linkArchivePath = new Map<string, string | null>();
  const ambiguousArchive = new Map<string, string[]>();
  const resumedSlugs = new Map<string, string>();
  for (const id2 of order) {
    const change = byId.get(id2)!;
    const evidence = await readEvidence(workspace, change.link);
    const result = executionOf(change.link, evidence);
    execution.set(id2, result.execution);
    executionEvidence.set(id2, result.evidence);
    linkTasks.set(id2, evidence.tasks ?? null);
    linkArchivePath.set(id2, evidence.archivePath ?? change.link?.archive_path ?? null);
    if (evidence.ambiguousArchive.length > 0) ambiguousArchive.set(id2, evidence.ambiguousArchive);
    // Both an active directory AND an archive answer to this slug. `executionOf`
    // reports `archived` (the archive wins, §7.7), which silently presents brand
    // new work as delivered. Keep the documented state, surface the collision.
    if (evidence.activeDirExists && evidence.archivePath) {
      resumedSlugs.set(id2, change.link!.name);
    }
  }

  // Readiness — in topological order, so a dependency is already resolved
  const readiness = new Map<string, ReturnType<typeof readinessOf>>();
  for (const id2 of order) {
    const change = byId.get(id2)!;
    const dependencyExecution = new Map<string, Execution>();
    for (const dependency of change.depends_on) {
      dependencyExecution.set(dependency, execution.get(dependency) ?? 'unknown');
    }
    readiness.set(
      id2,
      readinessOf({
        change,
        materialization: materialization.get(id2) ?? 'missing',
        dependencyExecution,
        diagnosticBlocking: invalidBrief.has(id2),
      })
    );
  }

  const views: ProjectChangeView[] = manifest.changes.map((change) => {
    const ready = readiness.get(change.id)!;
    const exec = execution.get(change.id)!;
    const ref = change.planned_change;
    return {
      id: change.id,
      slug: change.slug,
      title: change.title,
      planningState: change.planning_state,
      readiness: ready.readiness,
      readinessReasons: ready.reasons,
      execution: exec,
      executionEvidence: executionEvidence.get(change.id) ?? [],
      presentation: presentationOf({
        planningState: change.planning_state,
        readiness: ready.readiness,
        execution: exec,
        diagnosticBlocking: invalidBrief.has(change.id),
      }),
      priority: change.priority,
      milestone: change.milestone,
      dependsOn: [...change.depends_on],
      blockedBy: ready.blockedBy,
      manualBlockers: [...change.manual_blockers],
      unlocks: graph.dependents(change.id),
      supersededBy: [...change.superseded_by],
      plannedChange: ref
        ? {
            path: ref.path,
            state: materialization.get(change.id) ?? 'missing',
            generatedFromPlanRevision: ref.generated_from_plan_revision,
          }
        : null,
      link: change.link
        ? {
            name: change.link.name,
            activePath: change.link.active_path,
            archivePath: linkArchivePath.get(change.id) ?? null,
            tasks: linkTasks.get(change.id) ?? null,
          }
        : null,
    };
  });

  const count = (predicate: (view: ProjectChangeView) => boolean) => views.filter(predicate).length;
  const archived = count((view) => view.execution === 'archived');
  const total = views.length;

  const diagnostics = collectDiagnostics({
    workspace,
    manifest,
    paths,
    views,
    anySourceMissing,
    anySourceChanged,
    ambiguousArchive,
  });

  for (const [id2, messages] of invalidBrief) {
    diagnostics.push({
      level: 'ERROR',
      code: 'planned_change_invalid',
      path: `changes.${id2}.planned_change`,
      message: `o Planned Change de ${id2} não é válido: ${messages.join('; ')}`,
      fix: 'specs project validate --json',
    });
  }

  const derivedStatus = deriveStatus(manifest, views, diagnostics);
  if (derivedStatus !== manifest.status) {
    diagnostics.push({
      level: 'WARNING',
      code: 'stale_plan_status',
      path: 'status',
      message: `status declarado é "${manifest.status}", mas o derivado é "${derivedStatus}"`,
      // `set-state` moves an INCREMENT's planning_state; it cannot touch the
      // plan's declared status. These are the commands that actually can.
      fix: 'specs project pause | resume | archive, ou um bundle com plan.status',
    });
  }

  // What the workspace actually holds, read once: `next` uses it so it never
  // proposes creating a change that already exists, and the diagnostics use it
  // to notice archived work no increment claims.
  const activeChangeNames = new Set(await listChanges(workspace));
  const archivedSlugs = new Set(
    (await listArchivedChanges(workspace)).map((name) => name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-\d+$/, ''))
  );
  const claimedNames = new Set(
    manifest.changes.flatMap((change) => (change.link ? [change.link.name] : []))
  );
  for (const slug of [...archivedSlugs].sort()) {
    if (claimedNames.has(slug)) continue;
    diagnostics.push({
      level: 'WARNING',
      code: 'unclaimed_archive',
      path: `spec/changes/archive/${slug}`,
      message: `a change "${slug}" está arquivada, mas nenhum incremento do plano a reivindica — o progresso do plano não a conta`,
      fix: `specs project adopt ${slug}`,
    });
  }

  for (const [id2, slug] of resumedSlugs) {
    diagnostics.push({
      level: 'WARNING',
      code: 'ambiguous_execution',
      path: `changes.${id2}.link`,
      message: `"${slug}" tem um diretório ativo E um archive; ${id2} é reportado como concluído pelo archive, então o trabalho ativo fica invisível`,
      fix: `specs project unlink ${id2} --force`,
    });
  }

  const milestones: MilestoneView[] = [...manifest.milestones]
    .sort((a, b) => a.order - b.order)
    .map((milestone) => {
      const memberViews = views.filter((view) => view.milestone === milestone.id);
      const done = memberViews.filter((view) => view.execution === 'archived').length;
      const active = memberViews.some(
        (view) =>
          view.execution === 'in_progress' ||
          view.execution === 'verifying' ||
          view.execution === 'archived' ||
          view.readiness === 'ready'
      );
      return {
        id: milestone.id,
        name: milestone.name,
        order: milestone.order,
        changes: [...milestone.changes],
        archived: done,
        total: memberViews.length,
        derivedStatus:
          memberViews.length > 0 && done === memberViews.length
            ? 'completed'
            : active
              ? 'in_progress'
              : 'not_started',
      };
    });

  return {
    plan: {
      id: manifest.id,
      name: manifest.name,
      path: path.relative(workspace.projectRoot, paths.dir).replace(/\\/g, '/'),
      revision: manifest.revision,
      status: manifest.status,
      derivedStatus,
      ...(manifest.owner ? { owner: manifest.owner } : {}),
      updatedAt: manifest.updated_at,
    },
    workspace: workspace.root,
    progress: {
      total,
      archived,
      // `readiness` keeps being computed for an archived increment (§7.6, cenário
      // D), so counting it raw reports delivered work as outstanding. §8's archive
      // sequence pins the contract: two increments archived and one newly
      // unblocked is `archived=2, ready=1`, not 3. Same rule `next` uses for
      // eligibility, so the payload cannot disagree with its own recommendation.
      ready: count((view) => view.readiness === 'ready' && view.execution !== 'archived'),
      blocked: count((view) => view.readiness === 'blocked' && view.execution !== 'archived'),
      inProgress: count((view) => view.execution === 'in_progress' || view.execution === 'verifying'),
      idea: count((view) => view.planningState === 'idea'),
      onHold: count((view) => view.planningState === 'on_hold'),
      cancelled: count((view) => view.planningState === 'cancelled'),
      percent: total === 0 ? 0 : Math.round((archived / total) * 100),
    },
    changes: views,
    milestones,
    diagnostics,
    graph,
    workspaceChanges: { active: activeChangeNames, archivedSlugs },
    manifest,
  };
}

function deriveStatus(
  manifest: PlanManifest,
  views: ProjectChangeView[],
  diagnostics: DiagnosticView[]
): DerivedStatus {
  if (manifest.status === 'paused') return 'paused';
  if (manifest.status === 'archived') return 'archived';

  const blocking = diagnostics.some((diagnostic) => diagnostic.level === 'ERROR');
  const settled = views.every(
    (view) => view.execution === 'archived' || view.planningState === 'cancelled'
  );
  // A ready-but-archived increment is done, not "an eligible increment left".
  const anyReady = views.some(
    (view) => view.readiness === 'ready' && view.execution !== 'archived'
  );
  if (views.length > 0 && settled && !blocking && !anyReady) return 'completed';

  if (
    (manifest.status === 'draft' || manifest.status === 'reviewing') &&
    !manifest.changes.some((change) => change.planned_change)
  ) {
    return manifest.status;
  }
  return 'active';
}

interface DiagnosticsInput {
  workspace: Workspace;
  manifest: PlanManifest;
  paths: { planDoc: string; architecture: string; plannedChangesDir: string };
  views: ProjectChangeView[];
  anySourceMissing: boolean;
  anySourceChanged: boolean;
  ambiguousArchive: Map<string, string[]>;
}

function collectDiagnostics(input: DiagnosticsInput): DiagnosticView[] {
  const diagnostics: DiagnosticView[] = [];
  const { manifest, views } = input;

  const linkOwners = new Map<string, string[]>();
  for (const change of manifest.changes) {
    if (change.link) {
      linkOwners.set(change.link.name, [...(linkOwners.get(change.link.name) ?? []), change.id]);
    }
  }
  for (const [name, owners] of linkOwners) {
    if (owners.length > 1) {
      diagnostics.push({
        level: 'ERROR',
        code: 'duplicate_link',
        path: `changes.${owners.join(',')}.link`,
        message: `a change "${name}" está vinculada a mais de um incremento: ${owners.join(', ')}`,
      });
    }
  }

  for (const view of views) {
    if (view.link && view.execution === 'unknown') {
      diagnostics.push({
        level: 'ERROR',
        code: 'dangling_link',
        path: `changes.${view.id}.link`,
        message: `o vínculo de ${view.id} aponta para "${view.link.name}", que não existe ativa nem arquivada`,
        fix: 'specs project sync',
      });
    }
  }

  for (const [id, candidates] of input.ambiguousArchive) {
    diagnostics.push({
      level: 'WARNING',
      code: 'ambiguous_archive_match',
      path: `changes.${id}.link`,
      message: `mais de um archive candidato: ${candidates.join(', ')}`,
    });
  }

  if (input.anySourceMissing) {
    diagnostics.push({
      level: 'WARNING',
      code: 'missing_source',
      path: 'source_documents',
      message: 'um ou mais documentos-fonte não existem agora',
    });
  }
  if (input.anySourceChanged) {
    diagnostics.push({
      level: 'WARNING',
      code: 'source_changed',
      path: 'source_documents',
      message: 'um ou mais documentos-fonte mudaram desde o registro',
      fix: 'specs project generate --dry-run',
    });
  }

  return diagnostics;
}

/** The rows `render.ts` needs to project the roadmap. */
export function roadmapRows(status: PlanStatus): Map<string, RoadmapRow> {
  return new Map(
    status.changes.map((view) => [
      view.id,
      {
        id: view.id,
        title: view.title,
        presentation: view.presentation,
        priority: view.priority,
        dependsOn: view.dependsOn,
      },
    ])
  );
}

/** The JSON contract of `specs project show <id>`. */
export async function showProjectChange(
  workspace: Workspace,
  planId: string,
  changeId: string
): Promise<Record<string, unknown>> {
  const status = await computeProjectStatus(workspace, planId);
  const view = status.changes.find((entry) => entry.id === changeId);
  if (!view) {
    throw new SpecError(`O incremento ${changeId} não existe no plano.`, {
      code: 'change_not_found',
      fix: 'specs project status --json',
    });
  }

  let plannedChange: unknown = null;
  const ref = status.manifest.changes.find((entry) => entry.id === changeId)?.planned_change;
  if (ref) {
    const briefAbsolute = safeResolve(
      path.join(workspace.projectRoot, status.plan.path),
      ref.path
    );
    const content =
      briefAbsolute === undefined ? undefined : await readFileIfExists(briefAbsolute);
    if (content !== undefined) {
      const parsed = parsePlannedChange(content);
      plannedChange = {
        path: ref.path,
        frontmatter: parsed.frontmatter ?? null,
        sections: parsed.sections.map((section) => ({
          title: section.title,
          content: section.content,
        })),
      };
    }
  }

  const resolve = (ids: string[]) =>
    ids.map((id) => {
      const dependency = status.changes.find((entry) => entry.id === id);
      return {
        id,
        readiness: dependency?.readiness ?? 'unknown',
        execution: dependency?.execution ?? 'unknown',
        presentation: dependency?.presentation ?? 'desconhecida',
      };
    });

  return {
    change: view,
    plannedChange,
    dependencies: resolve(view.dependsOn),
    dependents: resolve(view.unlocks),
    ancestors: status.graph.ancestors(changeId),
    descendants: status.graph.descendants(changeId),
    diagnostics: status.diagnostics.filter((diagnostic) => diagnostic.path.includes(changeId)),
  };
}

/** The JSON contract of `specs project status`. */
export function statusPayload(status: PlanStatus): Record<string, unknown> {
  return {
    plan: status.plan,
    workspace: status.workspace,
    progress: status.progress,
    changes: status.changes,
    milestones: status.milestones,
    diagnostics: status.diagnostics,
  };
}
