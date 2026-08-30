import { promises as fs } from 'node:fs';
import { listSpecs } from './specs.js';
import { parseMainSpec } from './markdown/requirements.js';
import { summarizeChange, type ChangeSummary } from './change/model.js';
import { listChanges, type Workspace } from './workspace.js';

export type SortOrder = 'recent' | 'name';

export interface ChangeListEntry {
  id: string;
  title: string;
  deltas: number;
  tasks?: { total: number; completed: number };
}

export interface SpecListEntry {
  capability: string;
  requirements: number;
  purpose: string;
}

export async function listChangeEntries(
  workspace: Workspace,
  sort: SortOrder = 'recent'
): Promise<ChangeListEntry[]> {
  const summaries: ChangeSummary[] = [];
  for (const id of await listChanges(workspace)) {
    summaries.push(await summarizeChange(workspace, id));
  }

  summaries.sort((a, b) =>
    sort === 'name' ? a.id.localeCompare(b.id) : b.modifiedAt - a.modifiedAt || a.id.localeCompare(b.id)
  );

  return summaries.map((summary) => ({
    id: summary.id,
    title: summary.title,
    deltas: summary.deltaCount,
    ...(summary.tasks
      ? { tasks: { total: summary.tasks.total, completed: summary.tasks.completed } }
      : {}),
  }));
}

export async function listSpecEntries(workspace: Workspace): Promise<SpecListEntry[]> {
  const entries: SpecListEntry[] = [];

  for (const entry of await listSpecs(workspace)) {
    const spec = parseMainSpec(entry.capability, await fs.readFile(entry.filePath, 'utf8'));
    entries.push({
      capability: entry.capability,
      requirements: spec.requirements.length,
      purpose: spec.purpose.split('\n').map((line) => line.trim()).find(Boolean) ?? '',
    });
  }

  return entries.sort((a, b) => a.capability.localeCompare(b.capability));
}
