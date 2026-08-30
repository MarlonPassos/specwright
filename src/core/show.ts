import path from 'node:path';
import { promises as fs } from 'node:fs';
import { SpecError } from '../util/errors.js';
import { pathExists } from '../util/fs.js';
import { parseProposal, readDeltaSpecs, readTaskProgress, PROPOSAL_FILE } from './change/model.js';
import { readChangeMetadata } from './change/metadata.js';
import { readSpec, listSpecs } from './specs.js';
import { changeExists, changeDir, type Workspace } from './workspace.js';

export type ItemType = 'change' | 'spec';

export interface ShownDelta {
  capability: string;
  operation: string;
  requirement?: string;
  rename?: { from: string; to: string };
  scenarios?: string[];
  description: string;
}

export interface ShownChange {
  type: 'change';
  id: string;
  schema?: string;
  skipSpecs: boolean;
  proposal?: { why: string; whatChanges: string; capabilities: string; impact: string };
  deltas: ShownDelta[];
  tasks?: { total: number; completed: number; pending: string[] };
}

export interface ShownSpec {
  type: 'spec';
  capability: string;
  purpose: string;
  requirements: Array<{ name: string; text: string; scenarios: Array<{ name: string; text: string }> }>;
}

/** Resolves whether a name refers to a change or a spec, honouring an explicit type. */
export async function resolveItemType(
  workspace: Workspace,
  name: string,
  requested?: string
): Promise<ItemType> {
  if (requested === 'change' || requested === 'spec') return requested;

  const isChange = await changeExists(workspace, name);
  const isSpec = (await listSpecs(workspace)).some((entry) => entry.capability === name);

  if (isChange && isSpec) {
    throw new SpecError(
      `"${name}" is both a change and a capability. Pass --type change or --type spec.`,
      { code: 'ambiguous_item' }
    );
  }
  if (isChange) return 'change';
  if (isSpec) return 'spec';

  throw new SpecError(`No change or spec named "${name}"`, {
    code: 'item_not_found',
    fix: 'specs list',
  });
}

export async function showChange(
  workspace: Workspace,
  id: string,
  options: { deltasOnly?: boolean } = {}
): Promise<ShownChange> {
  const dir = changeDir(workspace, id);
  if (!(await pathExists(dir))) {
    throw new SpecError(`Change "${id}" does not exist`, { code: 'change_not_found', fix: 'specs list' });
  }

  const metadata = await readChangeMetadata(dir);
  const deltaSpecs = await readDeltaSpecs(dir);
  const deltas: ShownDelta[] = deltaSpecs.flatMap((spec) =>
    spec.entries.map((entry) => ({
      capability: entry.capability,
      operation: entry.operation,
      ...(entry.requirement ? { requirement: entry.requirement.name } : {}),
      ...(entry.rename ? { rename: entry.rename } : {}),
      ...(entry.requirement
        ? { scenarios: entry.requirement.scenarios.map((scenario) => scenario.name) }
        : {}),
      description: entry.description,
    }))
  );

  if (options.deltasOnly) {
    return { type: 'change', id, skipSpecs: metadata.skipSpecs, deltas };
  }

  const proposalPath = path.join(dir, PROPOSAL_FILE);
  const proposal = (await pathExists(proposalPath))
    ? parseProposal(await fs.readFile(proposalPath, 'utf8'))
    : undefined;
  const tasks = await readTaskProgress(dir);

  return {
    type: 'change',
    id,
    ...(metadata.metadata?.schema ? { schema: metadata.metadata.schema } : {}),
    skipSpecs: metadata.skipSpecs,
    ...(proposal ? { proposal } : {}),
    deltas,
    ...(tasks
      ? {
          tasks: {
            total: tasks.total,
            completed: tasks.completed,
            pending: tasks.tasks
              .filter((task) => !task.done)
              .map((task) => [task.number, task.text].filter(Boolean).join(' ')),
          },
        }
      : {}),
  };
}

export async function showSpec(workspace: Workspace, capability: string): Promise<ShownSpec> {
  const found = await readSpec(workspace, capability);
  if (!found) {
    throw new SpecError(`No spec for capability "${capability}"`, {
      code: 'spec_not_found',
      fix: 'specs list --specs',
    });
  }

  return {
    type: 'spec',
    capability,
    purpose: found.spec.purpose,
    requirements: found.spec.requirements.map((requirement) => ({
      name: requirement.name,
      text: requirement.text,
      scenarios: requirement.scenarios.map((scenario) => ({
        name: scenario.name,
        text: scenario.text,
      })),
    })),
  };
}
