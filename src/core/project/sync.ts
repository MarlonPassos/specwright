import { isDirectory } from '../../util/fs.js';
import { listChanges, type Workspace } from '../workspace.js';
import { loadPlan, savePlan } from './repository.js';
import { readEvidence, resolveArchiveEvidence } from './evidence.js';
import type { ProjectChange } from './model.js';
import { safeResolve } from './paths.js';
import { activePath } from './link.js';
import { localDateStamp } from '../../util/date.js';

export interface SyncResult {
  synced: boolean;
  checked: boolean;
  resolved: Array<{ id: string; archivePath: string }>;
  /** Links created by `--link`, empty unless it was asked for. */
  linked: Array<{ id: string; change: string; activePath: string | null; archivePath: string | null }>;
  cleared: string[];
  /** Increments whose `archive_path` pointed at something that is not a valid archive directory. */
  clearedArchive: string[];
  diagnostics: Array<{ level: string; code: string; path: string; message: string; fix?: string }>;
  revision: number;
}

/**
 * Reconciles the `link` block of vínculos that already exist: fills
 * `archive_path` when an archive resolves, clears `active_path` when the active
 * directory is gone, and reports `dangling_link`. Never adopts, never touches
 * the native change. Idempotent.
 *
 * A bare `sync` still never invents a link. `link: true` is the explicit,
 * opt-in operation that claims changes in bulk: for each increment with no
 * link, a change whose directory name EQUALS the increment's slug — active or
 * archived, and claimed by nobody — is linked. Exact identifier match only:
 * nothing is inferred from title, date or similarity. It exists because the
 * alternative was running `specs project link` once per increment by hand.
 */
export async function syncPlan(
  workspace: Workspace,
  planId: string,
  options: { check?: boolean; link?: boolean } = {}
): Promise<SyncResult> {
  const { manifest, paths } = await loadPlan(workspace.projectRoot, planId);
  const check = options.check === true;

  const resolved: SyncResult['resolved'] = [];
  const linked: SyncResult['linked'] = [];
  const cleared: string[] = [];
  const clearedArchive: string[] = [];
  const diagnostics: SyncResult['diagnostics'] = [];

  // Names already spoken for, so bulk linking can never steal one.
  const claimed = new Set(
    manifest.changes.flatMap((entry) => (entry.link ? [entry.link.name] : []))
  );
  const activeNames = options.link ? new Set(await listChanges(workspace)) : new Set<string>();

  const nextChanges: ProjectChange[] = [];
  let mutated = false;

  for (const change of manifest.changes) {
    if (!change.link) {
      const claimable =
        options.link === true &&
        change.planning_state !== 'cancelled' &&
        !claimed.has(change.slug);
      if (!claimable) {
        nextChanges.push(change);
        continue;
      }

      const activeDir = safeResolve(workspace.changesPath, change.slug);
      const activeExists = activeDir !== undefined && (await isDirectory(activeDir));
      const archiveDir = activeExists
        ? undefined
        : (await resolveArchiveEvidence(workspace, { name: change.slug })).chosen;
      if (!activeExists && !activeNames.has(change.slug) && archiveDir === undefined) {
        nextChanges.push(change);
        continue;
      }

      const created = {
        name: change.slug,
        active_path: activeExists ? activePath(change.slug) : null,
        archive_path: archiveDir ?? null,
        linked_at: localDateStamp(),
      };
      claimed.add(change.slug);
      linked.push({
        id: change.id,
        change: change.slug,
        activePath: created.active_path,
        archivePath: created.archive_path,
      });
      mutated = true;
      nextChanges.push({ ...change, link: created });
      continue;
    }

    const evidence = await readEvidence(workspace, change.link);
    const activeAbsolute =
      change.link.active_path === null
        ? undefined
        : safeResolve(workspace.projectRoot, change.link.active_path);
    // A change is a DIRECTORY. `pathExists` said yes to a regular file sitting
    // at `active_path`, so `sync` left a link the evidence reader already
    // considered dead — the reconciler disagreed with the reader (A-02).
    const activeExists = activeAbsolute !== undefined && (await isDirectory(activeAbsolute));

    let link = change.link;

    if (evidence.archivePath && change.link.archive_path !== evidence.archivePath) {
      link = { ...link, archive_path: evidence.archivePath };
      resolved.push({ id: change.id, archivePath: evidence.archivePath });
      mutated = true;
    }

    // A persisted `archive_path` that no longer resolves to an archive
    // DIRECTORY is a lie the plan keeps repeating. `sync` is the declared repair
    // for it (F-04), so it clears the field instead of leaving the increment
    // reading as concluded off a stale string.
    if (!evidence.archivePath && evidence.invalidArchivePath && link.archive_path !== null) {
      link = { ...link, archive_path: null };
      clearedArchive.push(change.id);
      mutated = true;
      diagnostics.push({
        level: 'WARNING',
        code: 'invalid_archive_path',
        path: `changes.${change.id}.link.archive_path`,
        message: `"${evidence.invalidArchivePath}" não é um diretório de archive de "${change.link.name}"`,
      });
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
    return {
      synced: true,
      checked: false,
      resolved,
      linked,
      cleared,
      clearedArchive,
      diagnostics,
      revision: next.revision,
    };
  }

  return {
    synced: !check && mutated,
    checked: check,
    resolved,
    linked,
    cleared,
    clearedArchive,
    diagnostics,
    revision: manifest.revision,
  };
}
