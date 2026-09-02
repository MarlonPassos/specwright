import { SpecError } from '../../util/errors.js';
import type { MaterializationState, PlanningState, Priority, ProjectChange } from './model.js';
import type { ChangeEvidence } from './evidence.js';
import { recordHash } from './hashes.js';

export type Readiness = 'ready' | 'blocked' | 'not_applicable';
export type Execution =
  | 'unlinked'
  | 'proposed'
  | 'in_progress'
  | 'verifying'
  | 'archived'
  | 'unknown';

export const PRIORITY_RANK: Record<Priority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

/** `set-state` transitions. No return from `cancelled`; resuming opens a new id. */
export const PLANNING_STATE_TRANSITIONS: Record<PlanningState, PlanningState[]> = {
  idea: ['planned', 'cancelled'],
  planned: ['on_hold', 'cancelled'],
  on_hold: ['planned', 'cancelled'],
  cancelled: [],
};

export function assertTransition(from: PlanningState, to: PlanningState): void {
  if (!PLANNING_STATE_TRANSITIONS[from].includes(to)) {
    const available = PLANNING_STATE_TRANSITIONS[from];
    throw new SpecError(
      available.length === 0
        ? `Não há transição a partir de "${from}".`
        : `Transição "${from}" → "${to}" não é válida. Disponíveis: ${available.join(', ')}.`,
      { code: 'invalid_transition', fix: 'specs project show <id> --json' }
    );
  }
}

export interface MaterializationInput {
  change: ProjectChange;
  /** Current bytes of the brief file, or undefined when it is absent. */
  briefContent: string | undefined;
  briefContentSha: string | undefined;
  /** Hash of the current source set. */
  currentSourceHash: string;
}

export function materializationState(input: MaterializationInput): MaterializationState {
  const ref = input.change.planned_change;
  if (!ref || input.briefContent === undefined || input.briefContentSha === undefined) {
    return 'missing';
  }
  if (input.briefContentSha !== ref.content_hash) return 'modified';
  if (input.currentSourceHash !== ref.source_hash) return 'outdated';
  // Relevant record change (slug/title/depends_on/milestone) since materialization.
  if (ref.record_hash !== undefined) {
    const current = recordHash({
      slug: input.change.slug,
      title: input.change.title,
      dependsOn: input.change.depends_on,
      milestone: input.change.milestone,
    });
    if (current !== ref.record_hash) return 'outdated';
  }
  return 'current';
}

export interface ExecutionResult {
  execution: Execution;
  evidence: string[];
}

export function executionOf(link: ProjectChange['link'], evidence: ChangeEvidence): ExecutionResult {
  if (!link) return { execution: 'unlinked', evidence: ['not_linked'] };
  if (evidence.archivePath) {
    return { execution: 'archived', evidence: ['archive_resolved'] };
  }
  if (!evidence.activeDirExists) {
    return { execution: 'unknown', evidence: ['link_dangling'] };
  }
  const codes = ['change_dir_present'];
  if (evidence.proposalPresent) codes.push('proposal_present');
  const tasks = evidence.tasks;
  if (tasks && tasks.total > 0 && tasks.completed === tasks.total) {
    codes.push('tasks_complete');
    return { execution: 'verifying', evidence: codes };
  }
  if (tasks && tasks.completed > 0) {
    codes.push('tasks_started');
    return { execution: 'in_progress', evidence: codes };
  }
  return { execution: 'proposed', evidence: codes };
}

export interface ReadinessInput {
  change: ProjectChange;
  materialization: MaterializationState;
  /** `execution` of every direct dependency. */
  dependencyExecution: Map<string, Execution>;
  /** True when a blocking diagnostic targets this change. */
  diagnosticBlocking?: boolean;
}

export interface ReadinessResult {
  readiness: Readiness;
  reasons: string[];
  /** Dependencies not yet archived. Empty when a manual blocker is the cause. */
  blockedBy: string[];
}

export function readinessOf(input: ReadinessInput): ReadinessResult {
  const { change } = input;
  if (change.planning_state !== 'planned') {
    return { readiness: 'not_applicable', reasons: ['state_not_eligible'], blockedBy: [] };
  }

  // A manual blocker takes precedence over every other cause (§7.7): it is the
  // single reported reason, and `blockedBy` stays empty because no dependency is
  // what is holding the increment back.
  if (change.manual_blockers.length > 0) {
    return { readiness: 'blocked', reasons: ['manual_blocker_present'], blockedBy: [] };
  }

  const reasons: string[] = [];
  if (input.materialization !== 'current') reasons.push(`planned_change_${input.materialization}`);
  if (input.diagnosticBlocking) reasons.push('diagnostic_blocking');

  const blockedBy = change.depends_on.filter(
    (id) => input.dependencyExecution.get(id) !== 'archived'
  );
  if (blockedBy.length > 0) reasons.push('dependency_pending');

  if (reasons.length > 0) {
    return { readiness: 'blocked', reasons, blockedBy };
  }
  return {
    readiness: 'ready',
    reasons: [
      change.depends_on.length > 0 ? 'dependencies_satisfied' : 'no_dependencies',
      'planned_change_current',
    ],
    blockedBy: [],
  };
}

export function presentationOf(input: {
  planningState: PlanningState;
  readiness: Readiness;
  execution: Execution;
  diagnosticBlocking?: boolean;
}): string {
  if (input.execution === 'archived') return 'concluída';
  if (input.diagnosticBlocking || input.execution === 'unknown') return 'inconsistente';
  if (input.execution === 'in_progress' || input.execution === 'verifying') return 'em implementação';
  if (input.execution === 'proposed') return 'proposta';
  if (input.readiness === 'ready') return 'pronta';
  if (input.readiness === 'blocked') return 'bloqueada';
  if (input.planningState === 'idea') return 'ideia';
  if (input.planningState === 'on_hold') return 'pausada';
  return 'cancelada';
}

const REASON_TEXT: Record<string, string> = {
  dependencies_satisfied: 'todas as dependências estão concluídas',
  no_dependencies: 'o incremento não tem dependências',
  planned_change_current: 'o Planned Change está materializado e atual',
  dependency_pending: 'pelo menos uma dependência não está concluída',
  manual_blocker_present: 'há um blocker declarado',
  planned_change_missing: 'o Planned Change não foi materializado',
  planned_change_outdated: 'a fonte mudou desde a materialização',
  planned_change_modified: 'o arquivo do Planned Change foi editado à mão',
  state_not_eligible: 'planning_state é idea, on_hold ou cancelled',
  diagnostic_blocking: 'há um diagnóstico impeditivo',
  not_linked: 'não há vínculo com uma change nativa',
  change_dir_present: 'o diretório da change existe',
  proposal_present: 'proposal.md existe',
  tasks_started: 'há pelo menos um item de checklist marcado',
  tasks_complete: 'todos os itens de checklist estão marcados',
  archive_resolved: 'um diretório de archive foi resolvido',
  link_dangling: 'nem diretório ativo nem archive foram encontrados',
};

export function describeReason(code: string): string {
  return REASON_TEXT[code] ?? code;
}
