import path from 'node:path';
import { SpecError } from '../../util/errors.js';
import { localDateStamp } from '../../util/date.js';
import { isDirectory, readFileIfExists } from '../../util/fs.js';
import { ARCHIVE_DIR, CHANGES_DIR, WORKSPACE_DIR, listChanges, type Workspace } from '../workspace.js';
import { parseProposal } from '../change/model.js';
import { loadPlan, savePlan } from './repository.js';
import { nextChangeId, type ChangeLink, type PlanningState, type ProjectChange } from './model.js';
import { readEvidence, resolveArchiveEvidence } from './evidence.js';
import { parseArchiveIdentity } from './archive-identity.js';
import { safeResolve } from './paths.js';
import { assertTransition, executionOf } from './state.js';
import { computeProjectStatus } from './status.js';

const KEBAB = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const ARCHIVE_DIR_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function activePath(name: string): string {
  return `${WORKSPACE_DIR}/${CHANGES_DIR}/${name}`;
}

async function currentExecution(workspace: Workspace, change: ProjectChange): Promise<string> {
  const evidence = await readEvidence(workspace, change.link);
  return executionOf(change.link, evidence).execution;
}

export interface LinkResult {
  linked: true;
  id: string;
  change: string;
  /** Null when the link resolved to an archive: there is no active directory. */
  activePath: string | null;
  /** Set when the link resolved to an archive instead of an active directory. */
  archivePath?: string;
  execution: string;
  executionEvidence: string[];
  revision: number;
  diagnostics: unknown[];
}


export async function linkChange(
  workspace: Workspace,
  planId: string,
  changeId: string,
  changeName: string
): Promise<LinkResult> {
  const { manifest, paths } = await loadPlan(workspace.projectRoot, planId);
  const change = manifest.changes.find((entry) => entry.id === changeId);
  if (!change) {
    throw new SpecError(`O incremento ${changeId} não existe no plano.`, {
      code: 'change_not_found',
      fix: 'specs project status --json',
    });
  }
  if (change.planning_state === 'cancelled') {
    throw new SpecError(`${changeId} está cancelado; não pode receber vínculo.`, {
      code: 'invalid_transition',
      fix: 'specs project show ' + changeId + ' --json',
    });
  }
  if ((await currentExecution(workspace, change)) === 'archived') {
    throw new SpecError(`${changeId} já está concluído; use unlink --force antes de revincular.`, {
      code: 'completed_change_protected',
    });
  }
  if (!KEBAB.test(changeName)) {
    throw new SpecError(`"${changeName}" não é um nome de change válido.`, {
      code: 'invalid_change_name',
    });
  }
  // A change is a DIRECTORY inside `spec/changes/`. A regular file is not a
  // change, and a symlink that realpaths outside the workspace is not either.
  const changeDir = safeResolve(workspace.changesPath, changeName);
  const activeExists = changeDir !== undefined && (await isDirectory(changeDir));

  // Work that is already finished still needs to reach the plan. `link` used to
  // look only at `spec/changes/<name>/`, so an increment whose change had been
  // archived could not be linked at all — and the error pointed at
  // `specs new change <name>`, which creates an empty directory that the archive
  // then masks (`executionOf` resolves the archive first). The plan would read
  // the increment as concluded with no work behind it. `adopt` already resolves
  // an archive; `link` now resolves it the same way.
  const archived = activeExists
    ? undefined
    : (await resolveArchiveEvidence(workspace, { name: changeName })).chosen;
  if (!activeExists && archived === undefined) {
    throw new SpecError(
      `Não encontrei "${changeName}" em spec/changes/ nem no archive.`,
      { code: 'link_target_missing', fix: `specs new change ${changeName}` }
    );
  }
  const owner = manifest.changes.find(
    (entry) => entry.id !== changeId && entry.link?.name === changeName
  );
  if (owner) {
    throw new SpecError(`A change "${changeName}" já está vinculada a ${owner.id}.`, {
      code: 'link_already_used',
      fix: `specs project show ${owner.id} --json`,
    });
  }

  const link: ChangeLink = {
    name: changeName,
    active_path: activeExists ? activePath(changeName) : null,
    archive_path: archived ?? null,
    linked_at: localDateStamp(),
  };
  const linked: ProjectChange = { ...change, link };
  const next = await savePlan(paths, {
    ...manifest,
    changes: manifest.changes.map((entry) => (entry.id === changeId ? linked : entry)),
  });

  const evidence = await readEvidence(workspace, link);
  const execution = executionOf(link, evidence);
  return {
    linked: true,
    id: changeId,
    change: changeName,
    activePath: link.active_path,
    ...(link.archive_path ? { archivePath: link.archive_path } : {}),
    execution: execution.execution,
    executionEvidence: execution.evidence,
    revision: next.revision,
    diagnostics: [],
  };
}

export interface UnlinkResult {
  unlinked: true;
  id: string;
  change: string;
  revision: number;
}

export async function unlinkChange(
  workspace: Workspace,
  planId: string,
  changeId: string,
  options: { force?: boolean } = {}
): Promise<UnlinkResult> {
  const { manifest, paths } = await loadPlan(workspace.projectRoot, planId);
  const change = manifest.changes.find((entry) => entry.id === changeId);
  if (!change || !change.link) {
    throw new SpecError(`O incremento ${changeId} não tem vínculo.`, {
      code: 'change_not_found',
      fix: 'specs project status --json',
    });
  }
  if ((await currentExecution(workspace, change)) === 'archived' && !options.force) {
    throw new SpecError(
      `${changeId} está concluído; desfazer o vínculo apaga rastreabilidade. Use --force.`,
      { code: 'completed_change_protected', fix: `specs project unlink ${changeId} --force` }
    );
  }
  const name = change.link.name;
  const next = await savePlan(paths, {
    ...manifest,
    changes: manifest.changes.map((entry) =>
      entry.id === changeId ? { ...entry, link: null } : entry
    ),
  });
  return { unlinked: true, id: changeId, change: name, revision: next.revision };
}

export interface AdoptResult {
  adopted: true;
  id: string;
  change: string;
  title: string;
  revision: number;
  diagnostics: unknown[];
}

export async function adoptChange(
  workspace: Workspace,
  planId: string,
  target: string
): Promise<AdoptResult> {
  const { manifest, paths } = await loadPlan(workspace.projectRoot, planId);

  assertSafeAdoptTarget(target);
  // `safeResolve` runs realpath: a symlink pointing outside the workspace
  // resolves to undefined and the target is simply not found (I-8, NFR-08).
  const activeDir = safeResolve(workspace.changesPath, target);
  const archiveDir = safeResolve(workspace.archivePath, target);

  let name: string;
  let link: ChangeLink;
  let proposalDir: string;

  if (activeDir !== undefined && (await isDirectory(activeDir))) {
    name = target;
    proposalDir = activeDir;
    link = {
      name,
      active_path: activePath(name),
      archive_path: null,
      linked_at: localDateStamp(),
    };
  } else if (archiveDir !== undefined && (await isDirectory(archiveDir))) {
    // `<date>-<slug>[-N]` is ambiguous: `2026-01-01-release-2` is either the
    // slug `release-2` or `release` archived twice on one day. Stripping
    // `-\d+$` blindly answered the second reading always, so adopting a change
    // whose slug ends in a number created the increment under a TRUNCATED slug
    // (F-07). Context decides; with no context, `adopt` refuses instead of
    // writing a guess into the plan.
    const identity = parseArchiveIdentity(target, await knownSlugs(workspace, manifest));
    if (identity.ambiguous) {
      throw new SpecError(
        `Não dá para saber se "${target}" é a change "${identity.slug}-${identity.collision}" ou a ${identity.collision}ª vez que "${identity.slug}" foi arquivada.`,
        {
          code: 'ambiguous_archive_identity',
          fix: `Declare o incremento no plano com o slug pretendido (specs project apply, op addChange) e depois rode specs project link <id> <slug>.`,
        }
      );
    }
    name = identity.slug;
    proposalDir = archiveDir;
    link = {
      name,
      active_path: null,
      archive_path: `${WORKSPACE_DIR}/${CHANGES_DIR}/${ARCHIVE_DIR}/${target}`,
      linked_at: localDateStamp(),
    };
  } else {
    throw new SpecError(`Não encontrei "${target}" em spec/changes/ nem no archive.`, {
      code: 'link_target_missing',
      fix: 'specs list',
    });
  }

  const owner = manifest.changes.find((entry) => entry.link?.name === name);
  if (owner) {
    throw new SpecError(`A change "${name}" já está vinculada a ${owner.id}.`, {
      code: 'link_already_used',
      fix: `specs project show ${owner.id} --json`,
    });
  }

  // `adopt` allocates a NEW increment, so a slug the plan already carries would
  // be written twice. A duplicate slug is a validation ERROR and makes the plan
  // unloadable, which `adopt` would have caused silently: the work already has
  // an increment, it just has no link yet. `link` is that operation.
  const planned = manifest.changes.find((entry) => entry.slug === name);
  if (planned) {
    throw new SpecError(
      `O incremento ${planned.id} já planeja o slug "${name}"; adotar criaria um slug duplicado.`,
      {
        code: 'slug_already_planned',
        fix:
          planned.planning_state === 'cancelled'
            ? `specs project set-state ${planned.id} planned`
            : `specs project link ${planned.id} ${name}`,
      }
    );
  }

  const proposal = await readFileIfExists(path.join(proposalDir, 'proposal.md'));
  const title =
    (proposal ? firstLine(parseProposal(proposal).why) : '') || name;

  const id = nextChangeId(manifest.changes);
  const record: ProjectChange = {
    id,
    slug: name,
    title,
    planning_state: 'planned',
    priority: 'medium',
    depends_on: [],
    manual_blockers: [],
    superseded_by: [],
    milestone: null,
    planned_change: null,
    link,
  };

  const next = await savePlan(paths, {
    ...manifest,
    changes: [...manifest.changes, record],
  });

  return {
    adopted: true,
    id,
    change: name,
    title,
    revision: next.revision,
    diagnostics: [
      {
        level: 'WARNING',
        code: 'planned_change_missing',
        path: `changes.${id}.planned_change`,
        message: `${id} foi adotado sem Planned Change; materialize com specs project generate --change ${id}`,
      },
    ],
  };
}

export interface SetStateResult {
  id: string;
  from: PlanningState;
  to: PlanningState;
  reason?: string;
  revision: number;
  readiness: string;
  execution: string;
}

export async function setPlanningState(
  workspace: Workspace,
  planId: string,
  changeId: string,
  to: PlanningState,
  reason?: string
): Promise<SetStateResult> {
  const { manifest, paths } = await loadPlan(workspace.projectRoot, planId);
  const change = manifest.changes.find((entry) => entry.id === changeId);
  if (!change) {
    throw new SpecError(`O incremento ${changeId} não existe no plano.`, {
      code: 'change_not_found',
      fix: 'specs project status --json',
    });
  }
  const from = change.planning_state;
  if ((to === 'on_hold' || to === 'cancelled') && !reason?.trim()) {
    throw new SpecError(`A transição para "${to}" exige --reason.`, {
      code: 'missing_reason',
      fix: `specs project set-state ${changeId} ${to} --reason "<texto>"`,
    });
  }
  assertTransition(from, to);

  const trimmed = reason?.trim();
  const next = await savePlan(paths, {
    ...manifest,
    changes: manifest.changes.map((entry) => {
      if (entry.id !== changeId) return entry;
      const updated = { ...entry, planning_state: to };
      // The motive is kept only while the increment sits paused or cancelled.
      if (to === 'planned') delete updated.reason;
      else if (trimmed) updated.reason = trimmed;
      return updated;
    }),
  });

  const status = await computeProjectStatus(workspace, planId);
  const view = status.changes.find((entry) => entry.id === changeId)!;

  return {
    id: changeId,
    from,
    to,
    ...(trimmed ? { reason: trimmed } : {}),
    revision: next.revision,
    readiness: view.readiness,
    execution: view.execution,
  };
}

/**
 * `adopt` takes a directory NAME, never a path. Anything that could leave
 * `spec/changes/` or `spec/changes/archive/` is refused before the first `stat`,
 * so a traversal can never be read from nor persisted into the manifest (I-8).
 */
function assertSafeAdoptTarget(target: string): void {
  const unsafe = (why: string): never => {
    throw new SpecError(`"${target}" não é um alvo válido para adopt: ${why}.`, {
      code: 'unsafe_plan_path',
      fix: 'specs list',
    });
  };
  if (target.includes('\0')) unsafe('contém byte NUL');
  if (path.isAbsolute(target) || /^[a-zA-Z]:[\\/]/.test(target)) unsafe('é um path absoluto');
  if (/[\\/]/.test(target)) unsafe('é um nome de diretório, não um caminho');
  if (target === '.' || target === '..') unsafe('não é um nome de diretório');
  // Either an active change slug, or an archive directory `<data>-<slug>[-N]`.
  if (!KEBAB.test(target) && !ARCHIVE_DIR_NAME.test(target)) {
    unsafe('deve ser um slug kebab-case ou um diretório de archive <YYYY-MM-DD>-<slug>[-N]');
  }
}

/**
 * Everything the workspace knows about change names, so an archive directory
 * name can be read against reality instead of a regex guess: the slugs the plan
 * declares, the names its links already claim, and the active change
 * directories. Read-only; `link.ts` already depends on the manifest it gets.
 */
async function knownSlugs(
  workspace: Workspace,
  manifest: { changes: ProjectChange[] }
): Promise<Set<string>> {
  const slugs = new Set<string>();
  for (const change of manifest.changes) {
    slugs.add(change.slug);
    if (change.link) slugs.add(change.link.name);
  }
  for (const name of await listChanges(workspace)) slugs.add(name);
  return slugs;
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  );
}
