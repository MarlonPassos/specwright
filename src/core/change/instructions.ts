import path from 'node:path';
import { SpecError } from '../../util/errors.js';
import { readTemplate } from '../schema/loader.js';
import { isPattern } from '../schema/outputs.js';
import { rulesFor } from '../config.js';
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
}

export type Instructions = ArtifactInstructions | PhaseInstructions;

const IMPLEMENT_FALLBACK =
  'Work through the change artifacts and complete the outstanding tasks in order.';

const ARCHIVE_INSTRUCTION = [
  'Close out a change that has been implemented and verified.',
  '',
  'Steps:',
  '1. Confirm every task in the tracked checklist is checked.',
  '2. Run `specs validate <change> --strict` and fix what it reports.',
  '3. Run `specs archive <change>` to fold the delta specs into the workspace specs',
  '   and move the change directory into the archive.',
  '',
  'Archiving rewrites the workspace specs, so it runs only after implementation is',
  'complete. Use `--skip-specs` only for a change that declared no spec deltas.',
].join('\n');

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
    };
  }

  const artifact = context.schema.graph.get(artifactId);
  if (!artifact) {
    const known = [
      ...context.schema.graph.buildOrder(),
      ...RESERVED_INSTRUCTION_IDS,
    ].join(', ');
    throw new SpecError(
      `Schema "${context.schema.name}" has no artifact "${artifactId}". Known ids: ${known}`,
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

