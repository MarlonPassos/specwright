import path from 'node:path';
import { SpecError } from '../../util/errors.js';
import { isDirectory } from '../../util/fs.js';
import { loadSchema, type LoadedSchema } from '../schema/loader.js';
import { resolveOutputs } from '../schema/outputs.js';
import { loadConfig, type WorkspaceConfig } from '../config.js';
import { changeDir, type Workspace } from '../workspace.js';
import { readChangeMetadata } from './metadata.js';
import { readTaskProgress, type TaskProgress } from './model.js';

export type ArtifactState = 'done' | 'ready' | 'blocked' | 'skipped';

export interface ArtifactStatus {
  id: string;
  description: string;
  state: ArtifactState;
  generates: string;
  /** Files that satisfy `generates`, relative to the change directory. */
  outputs: string[];
  requires: string[];
  /** Dependencies still missing; empty unless the state is `blocked`. */
  missing: string[];
}

export interface ChangeStatus {
  change: string;
  schema: string;
  workspace: string;
  changeRoot: string;
  skipSpecs: boolean;
  artifacts: ArtifactStatus[];
  /** Artifact ids implementation depends on, transitively, in build order. */
  applyRequires: string[];
  /** Artifacts that still block implementation. */
  applyBlockedBy: string[];
  ready: boolean;
  next: string[];
  tasks?: TaskSummary;
}

/**
 * O checklist da change, resumido.
 *
 * `open` carrega as primeiras tarefas ainda não marcadas — o que está em
 * andamento agora. Vem daqui, e não de uma segunda leitura do arquivo, porque
 * `tasks.md` já foi lido e parseado para contar o progresso; jogar os itens fora
 * e relê-los para mostrá-los seria ler o mesmo arquivo duas vezes.
 */
export interface TaskSummary {
  total: number;
  completed: number;
  /** Tarefas abertas, em ordem de arquivo, limitadas a `OPEN_TASKS_SHOWN`. */
  open: { number: string; text: string; group?: string }[];
}

/** Quantas tarefas abertas o resumo carrega. O resto se lê no próprio tasks.md. */
export const OPEN_TASKS_SHOWN = 5;

export interface StatusContext {
  workspace: Workspace;
  config: WorkspaceConfig;
  schema: LoadedSchema;
  changeId: string;
  dir: string;
  skipSpecs: boolean;
}

/**
 * Resolves everything a change-scoped command needs: the workspace config, the
 * schema the change was created with (or an explicit override), and the change
 * directory itself.
 */
export async function resolveChangeContext(
  workspace: Workspace,
  changeId: string,
  options: { schema?: string } = {}
): Promise<StatusContext> {
  const dir = changeDir(workspace, changeId);
  if (!(await isDirectory(dir))) {
    throw new SpecError(`A change "${changeId}" não existe`, {
      code: 'change_not_found',
      fix: 'specs list',
    });
  }

  const config = await loadConfig(workspace);
  const metadata = await readChangeMetadata(dir);
  if (metadata.malformed) {
    throw new SpecError(`${path.join(dir, '.change.yaml')} não é um metadado de change válido`, {
      code: 'invalid_change_metadata',
    });
  }

  const schemaName = options.schema ?? metadata.metadata?.schema ?? config.schema;
  const schema = await loadSchema(schemaName, workspace);

  return { workspace, config, schema, changeId, dir, skipSpecs: metadata.skipSpecs };
}

/**
 * The artifact ids a `skip_specs` change must NOT produce: the spec artifacts
 * themselves. An artifact is spec-producing when its output pattern lives under
 * `specs/`, which is how the schema declares delta specs.
 */
export function specArtifactIds(schema: LoadedSchema): string[] {
  return schema.file.artifacts
    .filter((artifact) => artifact.generates.replace(/\\/g, '/').startsWith('specs/'))
    .map((artifact) => artifact.id);
}

export async function computeStatus(context: StatusContext): Promise<ChangeStatus> {
  const { schema, dir, skipSpecs } = context;
  const skipped = new Set(skipSpecs ? specArtifactIds(schema) : []);
  const outputsById = new Map<string, string[]>();

  for (const artifact of schema.graph.artifacts) {
    outputsById.set(artifact.id, await resolveOutputs(dir, artifact.generates));
  }

  // A skipped artifact counts as satisfied so its dependents are not blocked
  // forever by a document the change deliberately does not produce.
  const completed = new Set<string>(
    schema.graph.artifacts
      .filter((artifact) => skipped.has(artifact.id) || outputsById.get(artifact.id)!.length > 0)
      .map((artifact) => artifact.id)
  );

  const blocked = schema.graph.blocked(completed);
  const ready = new Set(schema.graph.ready(completed));

  const artifacts: ArtifactStatus[] = schema.graph.buildOrder().map((id) => {
    const artifact = schema.graph.get(id)!;
    const outputs = outputsById.get(id)!;
    const state: ArtifactState = skipped.has(id)
      ? 'skipped'
      : outputs.length > 0
        ? 'done'
        : ready.has(id)
          ? 'ready'
          : 'blocked';

    return {
      id,
      description: artifact.description,
      state,
      generates: artifact.generates,
      outputs,
      requires: artifact.requires,
      missing: blocked[id] ?? [],
    };
  });

  const applyRequires = schema.graph.requiredForApply();
  const applyBlockedBy = applyRequires.filter((id) => {
    const status = artifacts.find((entry) => entry.id === id)!;
    return status.state !== 'done' && status.state !== 'skipped';
  });

  const tasks: TaskProgress | undefined = await readTaskProgress(dir);

  return {
    change: context.changeId,
    schema: schema.name,
    workspace: context.workspace.root,
    changeRoot: dir,
    skipSpecs,
    artifacts,
    applyRequires,
    applyBlockedBy,
    ready: applyBlockedBy.length === 0,
    next: artifacts.filter((entry) => entry.state === 'ready').map((entry) => entry.id),
    ...(tasks ? { tasks: summarizeTasks(tasks) } : {}),
  };
}

function summarizeTasks(tasks: TaskProgress): TaskSummary {
  return {
    total: tasks.total,
    completed: tasks.completed,
    open: tasks.tasks
      .filter((task) => !task.done)
      .slice(0, OPEN_TASKS_SHOWN)
      .map((task) => ({
        number: task.number,
        text: task.text,
        ...(task.group ? { group: task.group } : {}),
      })),
  };
}
