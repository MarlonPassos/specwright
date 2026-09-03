import path from 'node:path';
import { promises as fs } from 'node:fs';
import { findFilesNamed, readFileIfExists } from '../util/fs.js';
import { listPlanIds, planPaths, safeResolve } from './project/paths.js';
import { loadPlan } from './project/repository.js';
import { SPEC_FILE } from './specs.js';
import {
  ARCHIVE_DIR,
  PROJECT_FILE,
  listArchivedChanges,
  listChanges,
  type Workspace,
} from './workspace.js';

/**
 * The catalogue of every human-readable document the project keeps.
 *
 * The catalogue is also the security boundary. An `id` is not a path and is
 * never turned into one: `readDocument` rebuilds the same catalogue and looks
 * the id up, so a caller can only reach a file the catalogue itself decided to
 * publish. Nothing the caller sends is ever joined onto a directory.
 *
 * Machine metadata (`config.yaml`, `.change.yaml`, `plan.yaml`) is deliberately
 * absent: it is state, not reading material, and it already reaches the panel
 * through the projections.
 */

export type DocumentKind =
  | 'project'
  | 'capability'
  | 'proposal'
  | 'design'
  | 'tasks'
  | 'delta'
  | 'brief'
  | 'plan'
  | 'architecture';

export interface DocumentRef {
  /** Opaque handle. Looked up in the catalogue, never parsed into a path. */
  id: string;
  kind: DocumentKind;
  title: string;
  /** One line saying what this document is for, for a reader who is new here. */
  purpose: string;
  /** Section the document belongs to, used to group the navigation. */
  group: string;
  /** Project-relative path, for display and for opening it in an editor. */
  path: string;
  archived?: boolean;
}

interface Entry extends DocumentRef {
  absolute: string;
}

export interface ReadDocument extends DocumentRef {
  markdown: string;
}

const PURPOSE: Record<DocumentKind, string> = {
  project: 'Contexto do projeto — o que é, para quem, com que restrições',
  capability: 'Comportamento atual do sistema — a verdade acumulada',
  proposal: 'Por que esta change existe e o que ela cobre',
  design: 'Como a change será construída — decisões técnicas',
  tasks: 'Passo a passo da implementação, com o que já foi feito',
  delta: 'O que muda no comportamento desta capacidade',
  brief: 'Briefing do incremento planejado, antes de virar change',
  plan: 'Visão geral do plano: domínios, incrementos e milestones',
  architecture: 'Arquitetura alvo que o plano assume',
};

const GROUP_PROJECT = 'Projeto';
const GROUP_CAPABILITIES = 'Capacidades';
const GROUP_PLAN = 'Plano';
const GROUP_BRIEFS = 'Incrementos planejados';

function posix(relative: string): string {
  return relative.split(path.sep).join('/');
}

function relativeTo(workspace: Workspace, absolute: string): string {
  return posix(path.relative(workspace.projectRoot, absolute));
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

async function pushIfPresent(
  entries: Entry[],
  workspace: Workspace,
  absolute: string,
  ref: Omit<DocumentRef, 'path' | 'purpose'> & { purpose?: string }
): Promise<void> {
  if (!(await isFile(absolute))) return;
  entries.push({
    ...ref,
    purpose: ref.purpose ?? PURPOSE[ref.kind],
    path: relativeTo(workspace, absolute),
    absolute,
  });
}

/** The three change artifacts the schema declares, in the order they are written. */
const CHANGE_ARTIFACTS: Array<{ kind: DocumentKind; file: string; label: string }> = [
  { kind: 'proposal', file: 'proposal.md', label: 'Proposta' },
  { kind: 'design', file: 'design.md', label: 'Design' },
  { kind: 'tasks', file: 'tasks.md', label: 'Tarefas' },
];

async function collectChange(
  entries: Entry[],
  workspace: Workspace,
  dir: string,
  prefix: string,
  group: string,
  archived: boolean
): Promise<void> {
  for (const artifact of CHANGE_ARTIFACTS) {
    await pushIfPresent(entries, workspace, path.join(dir, artifact.file), {
      id: `${prefix}:${artifact.kind}`,
      kind: artifact.kind,
      title: artifact.label,
      group,
      archived: archived || undefined,
    });
  }

  const deltasRoot = path.join(dir, 'specs');
  for (const relative of await findFilesNamed(deltasRoot, SPEC_FILE)) {
    const capability = relative.slice(0, -(SPEC_FILE.length + 1));
    if (!capability) continue;
    await pushIfPresent(entries, workspace, path.join(deltasRoot, ...relative.split('/')), {
      id: `${prefix}:delta:${capability}`,
      kind: 'delta',
      title: `Delta · ${capability}`,
      group,
      archived: archived || undefined,
    });
  }
}

/**
 * Builds the catalogue. Absent files are simply absent: a change that has not
 * reached `design.md` yet must show three artifacts, not a broken link.
 */
async function catalogue(workspace: Workspace, planId?: string): Promise<Entry[]> {
  const entries: Entry[] = [];

  await pushIfPresent(entries, workspace, path.join(workspace.root, PROJECT_FILE), {
    id: 'project',
    kind: 'project',
    title: 'Projeto',
    group: GROUP_PROJECT,
  });

  for (const relative of await findFilesNamed(workspace.specsPath, SPEC_FILE)) {
    const capability = relative.slice(0, -(SPEC_FILE.length + 1));
    if (!capability) continue;
    await pushIfPresent(
      entries,
      workspace,
      path.join(workspace.specsPath, ...relative.split('/')),
      {
        id: `capability:${capability}`,
        kind: 'capability',
        title: capability,
        group: GROUP_CAPABILITIES,
      }
    );
  }

  for (const change of await listChanges(workspace)) {
    await collectChange(
      entries,
      workspace,
      path.join(workspace.changesPath, change),
      `change:${change}`,
      `Change · ${change}`,
      false
    );
  }

  for (const archived of await listArchivedChanges(workspace)) {
    await collectChange(
      entries,
      workspace,
      path.join(workspace.changesPath, ARCHIVE_DIR, archived),
      `archived:${archived}`,
      `Arquivada · ${archived}`,
      true
    );
  }

  await collectPlan(entries, workspace, planId);
  return entries;
}

async function collectPlan(
  entries: Entry[],
  workspace: Workspace,
  planId?: string
): Promise<void> {
  const ids = await listPlanIds(workspace.projectRoot);
  const id = planId ?? (ids.length === 1 ? ids[0] : undefined);
  if (id === undefined || !ids.includes(id)) return;

  const paths = planPaths(workspace.projectRoot, id);
  await pushIfPresent(entries, workspace, paths.planDoc, {
    id: `plandoc:${id}:plan`,
    kind: 'plan',
    title: 'Plano do projeto',
    group: GROUP_PLAN,
  });
  await pushIfPresent(entries, workspace, paths.architecture, {
    id: `plandoc:${id}:architecture`,
    kind: 'architecture',
    title: 'Arquitetura',
    group: GROUP_PLAN,
  });

  // Briefs come from the manifest, never from a directory listing: the record
  // is what says a brief exists and where it lives, and `safeResolve` fails
  // closed if a persisted path tries to escape the plan directory (I-8).
  let changes;
  try {
    ({
      manifest: { changes },
    } = await loadPlan(workspace.projectRoot, id));
  } catch {
    return;
  }

  for (const record of changes) {
    if (!record.planned_change) continue;
    const absolute = safeResolve(paths.dir, record.planned_change.path);
    if (absolute === undefined) continue;
    await pushIfPresent(entries, workspace, absolute, {
      id: `brief:${record.id}`,
      kind: 'brief',
      title: `${record.id} · ${record.title}`,
      group: GROUP_BRIEFS,
    });
  }
}

function strip(entry: Entry): DocumentRef {
  const { absolute: _absolute, ...ref } = entry;
  return ref;
}

export async function listDocuments(
  workspace: Workspace,
  planId?: string
): Promise<DocumentRef[]> {
  return (await catalogue(workspace, planId)).map(strip);
}

/**
 * Reads one catalogued document. An unknown id is `undefined`, never a path
 * lookup: the id must be one the catalogue published in this same call.
 */
export async function readDocument(
  workspace: Workspace,
  id: string,
  planId?: string
): Promise<ReadDocument | undefined> {
  const entry = (await catalogue(workspace, planId)).find((candidate) => candidate.id === id);
  if (!entry) return undefined;
  const markdown = await readFileIfExists(entry.absolute);
  if (markdown === undefined) return undefined;
  return { ...strip(entry), markdown };
}
