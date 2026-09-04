import path from 'node:path';
import { SpecError } from '../../util/errors.js';
import { readTemplate } from '../schema/loader.js';
import { isPattern } from '../schema/outputs.js';
import { rulesFor } from '../config.js';
import { detectHarness } from '../harness/current.js';
import { computeStatus, type StatusContext } from './status.js';

/** Instruction surfaces that are phases of the workflow, not artifacts. */
export const RESERVED_INSTRUCTION_IDS = ['implement', 'archive'] as const;
export type ReservedInstructionId = (typeof RESERVED_INSTRUCTION_IDS)[number];

export interface DependencyInstruction {
  id: string;
  /** Existing files for that dependency, relative to the change directory. */
  outputs: string[];
  state: string;
}

export interface ArtifactInstructions {
  kind: 'artifact';
  change: string;
  schema: string;
  workspace: string;
  changeRoot: string;
  artifact: string;
  description: string;
  /** Schema guidance for this artifact. */
  instruction: string;
  /** Structure to fill in. */
  template: string;
  /** Project background. A constraint for the writer, never file content. */
  context?: string;
  /** Artifact-specific project rules. Constraints, never file content. */
  rules: string[];
  /** Resolved path, or a pattern when the artifact produces several files. */
  outputPath: string;
  outputIsPattern: boolean;
  dependencies: DependencyInstruction[];
  /** Set when the change opted out of this artifact; it must not be written. */
  skipped?: true;
  warning?: string;
}

export interface PhaseInstructions {
  kind: 'phase';
  phase: ReservedInstructionId;
  change: string;
  schema: string;
  workspace: string;
  changeRoot: string;
  instruction: string;
  context?: string;
  /** Artifacts that must exist before the phase can start. */
  requires: string[];
  blockedBy: string[];
  /** File whose checkboxes track progress, when the schema declares one. */
  tracks?: string;
  tasks?: { total: number; completed: number };
  /**
   * Present only for `implement`. `supported` is true only when BOTH the
   * running harness declares a native subagent primitive AND this change's
   * `.change.yaml` opts in with `parallel: true` - a change that never opted
   * in cannot enter parallel mode no matter how capable the harness is.
   */
  parallelDispatch?: { supported: boolean; primitive?: string };
}

export type Instructions = ArtifactInstructions | PhaseInstructions;

const IMPLEMENT_FALLBACK =
  'Percorra os artefatos da change e conclua as tarefas pendentes em ordem.';

const ARCHIVE_INSTRUCTION = [
  'Encerre uma change que já foi implementada e verificada.',
  '',
  'Passos:',
  '1. Confirme que toda tarefa do checklist acompanhado está marcada.',
  '2. Rode `specs validate <change> --strict` e corrija o que for reportado.',
  '3. Rode `specs archive <change>` para aplicar as delta specs nas specs do workspace',
  '   e mover o diretório da change para o arquivo.',
  '',
  'O arquivamento reescreve as specs do workspace, então só roda depois que a implementação',
  'está concluída. Use `--skip-specs` apenas para uma change que não declarou deltas de spec.',
].join('\n');

/**
 * Combines the running harness's capability with this change's opt-in. Both
 * must hold - a capable harness alone must never be enough, or a change that
 * predates this feature (no `parallel:` field at all) would silently start
 * fanning out to worktrees the first time it happens to run under a harness
 * that supports it.
 */
function resolveParallelDispatch(context: StatusContext): { supported: boolean; primitive?: string } {
  const harness = detectHarness({ configured: context.config.harnesses });
  const supported = context.parallel && harness.supportsParallelDispatch === true;
  return {
    supported,
    ...(harness.parallelDispatchPrimitive ? { primitive: harness.parallelDispatchPrimitive } : {}),
  };
}

export async function buildInstructions(
  context: StatusContext,
  artifactId: string
): Promise<Instructions> {
  const status = await computeStatus(context);

  if ((RESERVED_INSTRUCTION_IDS as readonly string[]).includes(artifactId)) {
    const phase = artifactId as ReservedInstructionId;
    const apply = context.schema.graph.apply;

    return {
      kind: 'phase',
      phase,
      change: context.changeId,
      schema: context.schema.name,
      workspace: context.workspace.root,
      changeRoot: context.dir,
      instruction:
        phase === 'archive' ? ARCHIVE_INSTRUCTION : apply?.instruction?.trim() ?? IMPLEMENT_FALLBACK,
      ...(context.config.context ? { context: context.config.context.trim() } : {}),
      requires: status.applyRequires,
      blockedBy: status.applyBlockedBy,
      ...(apply?.tracks ? { tracks: apply.tracks } : {}),
      ...(status.tasks ? { tasks: status.tasks } : {}),
      ...(phase === 'implement' ? { parallelDispatch: resolveParallelDispatch(context) } : {}),
    };
  }

  const artifact = context.schema.graph.get(artifactId);
  if (!artifact) {
    const known = [
      ...context.schema.graph.buildOrder(),
      ...RESERVED_INSTRUCTION_IDS,
    ].join(', ');
    throw new SpecError(
      `O schema "${context.schema.name}" não tem o artefato "${artifactId}". Ids conhecidos: ${known}`,
      { code: 'artifact_not_found' }
    );
  }

  const artifactStatus = status.artifacts.find((entry) => entry.id === artifactId)!;
  const skipped = artifactStatus.state === 'skipped';

  const dependencies: DependencyInstruction[] = artifact.requires.map((id) => {
    const dependency = status.artifacts.find((entry) => entry.id === id)!;
    return { id, outputs: dependency.outputs, state: dependency.state };
  });

  return {
    kind: 'artifact',
    change: context.changeId,
    schema: context.schema.name,
    workspace: context.workspace.root,
    changeRoot: context.dir,
    artifact: artifact.id,
    description: artifact.description,
    instruction: artifact.instruction?.trim() ?? '',
    template: await readTemplate(context.schema, artifact.template),
    ...(context.config.context ? { context: context.config.context.trim() } : {}),
    rules: rulesFor(context.config, artifact.id),
    outputPath: path.join(context.dir, artifact.generates),
    outputIsPattern: isPattern(artifact.generates),
    dependencies,
    ...(skipped
      ? {
          skipped: true as const,
          warning:
            `Change "${context.changeId}" sets skip_specs: true, so ${artifact.id} must not be ` +
            'created. Pick another artifact, or remove skip_specs from .change.yaml first.',
        }
      : {}),
  };
}

