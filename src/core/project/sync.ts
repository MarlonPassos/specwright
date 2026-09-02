import path from 'node:path';
import { pathExists } from '../../util/fs.js';
import { type Workspace } from '../workspace.js';
import { loadPlan, savePlan } from './repository.js';
import { readEvidence } from './evidence.js';
import type { ProjectChange } from './model.js';

export interface SyncResult {
  synced: boolean;
  checked: boolean;
  resolved: Array<{ id: string; archivePath: string }>;
  cleared: string[];
  diagnostics: Array<{ level: string; code: string; path: string; message: string; fix?: string }>;
  revision: number;
}

/**
 * Reconciles the `link` block of vínculos that already exist: fills
 * `archive_path` when an archive resolves, clears `active_path` when the active
 * directory is gone, and reports `dangling_link`. Never creates a link, never
 * adopts, never touches the native change. Idempotent.
 */
export async function syncPlan(
  workspace: Workspace,
  planId: string,
  options: { check?: boolean } = {}
): Promise<SyncResult> {
  const { manifest, paths } = await loadPlan(workspace.projectRoot, planId);
  const check = options.check === true;

  const resolved: SyncResult['resolved'] = [];
  const cleared: string[] = [];
  const diagnostics: SyncResult['diagnostics'] = [];

  const nextChanges: ProjectChange[] = [];
  let mutated = false;

  for (const change of manifest.changes) {
    if (!change.link) {
      nextChanges.push(change);
      continue;
    }

    const evidence = await readEvidence(workspace, change.link);
    const activeExists =
      change.link.active_path !== null &&
      (await pathExists(path.join(workspace.projectRoot, change.link.active_path)));

    let link = change.link;

    if (evidence.archivePath && change.link.archive_path !== evidence.archivePath) {
      link = { ...link, archive_path: evidence.archivePath };
      resolved.push({ id: change.id, archivePath: evidence.archivePath });
      mutated = true;
    }

    if (!activeExists && link.active_path !== null && (evidence.archivePath || link.archive_path)) {
      link = { ...link, active_path: null };
      cleared.push(change.id);
      mutated = true;
    }

    if (!activeExists && !evidence.archivePath && !link.archive_path) {
      diagnostics.push({
        level: 'ERROR',
        code: 'dangling_link',
        path: `changes.${change.id}.link`,
        message: `o vínculo de ${change.id} aponta para "${change.link.name}", que não existe ativa nem arquivada`,
      });
    }

    if (evidence.ambiguousArchive.length > 1) {
      diagnostics.push({
        level: 'WARNING',
        code: 'ambiguous_archive_match',
        path: `changes.${change.id}.link`,
        message: `mais de um archive candidato: ${evidence.ambiguousArchive.join(', ')}`,
      });
    }

    nextChanges.push(link === change.link ? change : { ...change, link });
  }

  if (mutated && !check) {
    const next = await savePlan(paths, { ...manifest, changes: nextChanges });
    return { synced: true, checked: false, resolved, cleared, diagnostics, revision: next.revision };
  }

  return {
    synced: !check && mutated,
    checked: check,
    resolved,
    cleared,
    diagnostics,
    revision: manifest.revision,
  };
}
