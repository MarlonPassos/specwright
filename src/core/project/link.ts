import path from 'node:path';
import { SpecError } from '../../util/errors.js';
import { localDateStamp } from '../../util/date.js';
import { pathExists, readFileIfExists } from '../../util/fs.js';
import { ARCHIVE_DIR, CHANGES_DIR, WORKSPACE_DIR, type Workspace } from '../workspace.js';
import { parseProposal } from '../change/model.js';
import { loadPlan, savePlan } from './repository.js';
import { nextChangeId, type ChangeLink, type PlanningState, type ProjectChange } from './model.js';
import { readEvidence } from './evidence.js';
import { assertTransition, executionOf } from './state.js';
import { computeProjectStatus } from './status.js';

const KEBAB = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function activePath(name: string): string {
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
  activePath: string;
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
  if (!(await pathExists(path.join(workspace.changesPath, changeName)))) {
    throw new SpecError(`spec/changes/${changeName}/ não existe.`, {
      code: 'link_target_missing',
      fix: `specs new change ${changeName}`,
    });
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
    active_path: activePath(changeName),
    archive_path: null,
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
    activePath: link.active_path!,
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

  const activeDir = path.join(workspace.changesPath, target);
  const archiveDir = path.join(workspace.archivePath, target);

  let name: string;
  let link: ChangeLink;
  let proposalDir: string;

  if (await pathExists(activeDir)) {
    name = target;
    proposalDir = activeDir;
    link = {
      name,
      active_path: activePath(name),
      archive_path: null,
      linked_at: localDateStamp(),
    };
  } else if (await pathExists(archiveDir)) {
    name = target.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-\d+$/, '');
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

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  );
}
