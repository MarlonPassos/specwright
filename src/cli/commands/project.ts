import type { Command } from 'commander';
import { SpecError } from '../../util/errors.js';
import { requireWorkspace } from '../../core/workspace.js';
import { createPlan } from '../../core/project/create.js';
import { validatePlan } from '../../core/project/validate.js';
import { resolvePlanId, listPlanIds } from '../../core/project/paths.js';
import { computeProjectStatus, showProjectChange, statusPayload } from '../../core/project/status.js';
import { recommendNext } from '../../core/project/next.js';
import { generatePlannedChanges } from '../../core/project/generate.js';
import { linkChange, unlinkChange, adoptChange, setPlanningState } from '../../core/project/link.js';
import { syncPlan } from '../../core/project/sync.js';
import { applyPlanBundle } from '../../core/project/apply.js';
import { BUNDLE_VERSION } from '../../core/project/bundle.js';
import { bundleContract, renderBundleContract } from '../../core/project/bundle-schema.js';
import { computeImpact } from '../../core/project/impact.js';
import { loadPlan, savePlan } from '../../core/project/repository.js';
import { PLANNING_STATES, type PlanningState, type PlanStatusValue } from '../../core/project/model.js';
import type { ValidationReport } from '../../core/validate/report.js';
import { renderProjectDashboard } from '../project-dashboard-view.js';
import type { ViewOptions } from '../theme.js';
import { PLAN_TAB, runPanel } from '../panel.js';
import { fail, printJson, printLines } from '../output.js';
import { dashboardEnvelope } from '../../core/contract.js';



function intervalMs(raw: string | undefined): number {
  const seconds = Number(raw ?? '2');
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new SpecError(`"${raw}" não é um intervalo válido.`, { code: 'invalid_interval' });
  }
  return Math.round(seconds * 1000);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** `--json` for a subcommand: its own flag, or the group's. */
function wantsJson(command: Command): boolean {
  return command.opts().json === true || command.parent?.opts().json === true;
}

/** Same rules as `specs status`: colour only on a TTY the user has not opted out of. */
function viewOptions(command: Command): ViewOptions {
  const noColor = command.opts().color === false || command.parent?.opts().color === false;
  return {
    color: !noColor && !process.env.NO_COLOR && Boolean(process.stdout.isTTY),
    width: process.stdout.columns ?? 80,
  };
}

export function registerProjectCommands(program: Command): void {
  const project = program
    .command('project')
    .description('Planejamento de projeto: decompõe um documento grande em incrementos ordenados')
    .option('--json', 'Saída em JSON')
    .option('--watch', 'Repinta o dashboard por polling até Ctrl+C')
    .option('--interval <segundos>', 'Intervalo do --watch em segundos', '2')
    .option('--no-color', 'Desenha o painel sem cor nem glifos Unicode')
    .action(async function (
      this: Command,
      options: { json?: boolean; watch?: boolean; interval?: string; color?: boolean }
    ) {
      try {
        if (options.json && options.watch) {
          throw new SpecError('--json e --watch são mutuamente exclusivos.', { code: 'invalid_option' });
        }
        const workspace = await requireWorkspace();
        const ids = await listPlanIds(workspace.projectRoot);
        if (ids.length === 0) {
          const message = 'Nenhum plano ainda. Crie um com: specs project create <plan-id> [fontes...]';
          if (options.json) printJson({ plan: null, message });
          else printLines([message]);
          return;
        }

        const id = await resolvePlanId(workspace.projectRoot);

        if (options.watch) {
          // Opens on PLANO, the screen this command has always drawn; the other
          // tabs are one key away.
          await runPanel(workspace, {
            initial: PLAN_TAB,
            intervalMs: intervalMs(options.interval),
            view: viewOptions(this),
            planId: id,
          });
          return;
        }

        const status = await computeProjectStatus(workspace, id);
        const next = recommendNext(status);

        if (options.json) {
          printJson(
            dashboardEnvelope({ ...statusPayload(status), recommended: next.recommended })
          );
          return;
        }
        process.stdout.write(renderProjectDashboard(status, next, viewOptions(this)));
      } catch (error) {
        fail(error, { json: options.json, payload: { plan: null } });
      }
    });

  project
    .command('create <plan-id> [sources...]')
    .description('Cria planning/<plan-id>/ com plan.yaml (draft), plan.md, architecture.md e planned-changes/')
    .option('--name <nome>', 'Nome humano do plano')
    .option('--owner <nome>', 'Responsável pelo plano')
    .option('--json', 'Saída em JSON')
    .action(async function (
      this: Command,
      planId: string,
      sources: string[],
      options: { name?: string; owner?: string }
    ) {
      const json = wantsJson(this);
      try {
        const workspace = await requireWorkspace();
        const result = await createPlan(workspace.projectRoot, planId, {
          name: options.name,
          owner: options.owner,
          sources,
        });
        if (json) {
          printJson(result);
          return;
        }
        printLines([
          `Plano "${result.plan}" criado em ${result.path}`,
          ...result.created.map((file) => `  + ${file}`),
        ]);
      } catch (error) {
        fail(error, { json, payload: { plan: null } });
      }
    });

  project
    .command('validate [plan-id]')
    .description('Valida o manifesto, os Planned Changes, as fontes e os vínculos')
    .option('--strict', 'Trata warnings como falhas')
    .option('--json', 'Saída em JSON')
    .action(async function (this: Command, planId: string | undefined, options: { strict?: boolean }) {
      const json = wantsJson(this);
      try {
        const workspace = await requireWorkspace();
        const strict = options.strict === true;
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const reports = await validatePlan(workspace.projectRoot, id, { strict });
        const valid = reports.every((report) => report.valid);

        if (json) {
          printJson({
            valid,
            strict,
            reports,
            summary: {
              items: reports.length,
              errors: reports.reduce((total, report) => total + report.summary.errors, 0),
              warnings: reports.reduce((total, report) => total + report.summary.warnings, 0),
            },
          });
        } else {
          printLines(formatReports(reports, valid));
        }
        if (!valid) process.exitCode = 1;
      } catch (error) {
        fail(error, { json, payload: { valid: false, reports: [] } });
      }
    });

  project
    .command('status [plan-id]')
    .description('Progresso, bloqueios, três dimensões por incremento e diagnósticos')
    .option('--json', 'Saída em JSON')
    .option('--no-color', 'Desenha o painel sem cor nem glifos Unicode')
    .action(async function (this: Command, planId: string | undefined) {
      const json = wantsJson(this);
      try {
        const workspace = await requireWorkspace();
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const status = await computeProjectStatus(workspace, id);
        const next = recommendNext(status);
        if (json) printJson(statusPayload(status));
        else process.stdout.write(renderProjectDashboard(status, next, viewOptions(this)));
      } catch (error) {
        fail(error, { json, payload: { plan: null } });
      }
    });

  project
    .command('next [plan-id]')
    .description('Recomenda o próximo incremento, com razões, alternativas e exclusões')
    .option('--json', 'Saída em JSON')
    .action(async function (this: Command, planId: string | undefined) {
      const json = wantsJson(this);
      try {
        const workspace = await requireWorkspace();
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const status = await computeProjectStatus(workspace, id);
        const recommendation = recommendNext(status);
        if (json) printJson(recommendation);
        else printLines(formatNext(recommendation));
      } catch (error) {
        fail(error, {
          json,
          payload: { recommended: null, alternatives: [], parallelReady: [] },
        });
      }
    });

  project
    .command('show [plan-id] [change-id]')
    .description('O registro, o Planned Change parseado, dependências e as três dimensões de um incremento')
    .option('--json', 'Saída em JSON')
    .action(async function (
      this: Command,
      planId: string | undefined,
      changeId: string | undefined
    ) {
      const json = wantsJson(this);
      try {
        const workspace = await requireWorkspace();
        let resolvedPlan = planId;
        let resolvedChange = changeId;
        if (changeId === undefined) {
          resolvedChange = planId;
          resolvedPlan = undefined;
        }
        if (!resolvedChange) {
          throw new SpecError('Informe o id do incremento: specs project show <change-id>', {
            code: 'change_not_found',
          });
        }
        const id = await resolvePlanId(workspace.projectRoot, resolvedPlan);
        const payload = await showProjectChange(workspace, id, resolvedChange);
        if (json) {
          printJson(payload);
          return;
        }
        const view = payload.change as {
          id: string;
          title: string;
          presentation: string;
          readinessReasons: string[];
        };
        printLines([
          `${view.id}  ${view.title}`,
          `  ${view.presentation} — ${view.readinessReasons.join(', ')}`,
        ]);
      } catch (error) {
        fail(error, { json, payload: { change: null } });
      }
    });

  project
    .command('generate [plan-id]')
    .description('Materializa Planned Changes dos incrementos selecionados')
    .option('--change <id...>', 'Incrementos específicos')
    .option('--milestone <id>', 'Todos os incrementos "planned" de um milestone')
    .option('--dry-run', 'Mostra o que seria gravado sem tocar no disco')
    .option('--force', 'Sobrescreve um Planned Change editado à mão')
    .option('--expect-revision <n>', 'Falha se a revisão no disco diferir')
    .option('--json', 'Saída em JSON')
    .action(async function (
      this: Command,
      planId: string | undefined,
      options: {
        change?: string[];
        milestone?: string;
        dryRun?: boolean;
        force?: boolean;
        expectRevision?: string;
      }
    ) {
      const json = wantsJson(this);
      try {
        const workspace = await requireWorkspace();
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const result = await generatePlannedChanges(workspace, id, {
          changeIds: options.change,
          milestone: options.milestone,
          dryRun: options.dryRun,
          force: options.force,
          expectRevision:
            options.expectRevision !== undefined ? Number(options.expectRevision) : undefined,
        });

        if (result.conflicts.length > 0) {
          const error = new SpecError(
            `${result.conflicts.length} Planned Change tem edição humana. Revise o conflito antes de materializar de novo.`,
            {
              code: 'planned_change_modified',
              fix: `specs project generate --change ${result.conflicts[0].id} --force`,
            }
          );
          fail(error, {
            json,
            payload: { generated: false, dryRun: result.dryRun, conflicts: result.conflicts },
          });
          return;
        }

        if (json) {
          printJson(result);
          return;
        }
        printLines([
          result.dryRun ? 'Prévia (nada foi escrito):' : 'Materialização concluída.',
          ...result.written.map((file) => `  + ${file}`),
          ...result.skipped.map((entry) => `  = ${entry.id} (${entry.reason})`),
        ]);
      } catch (error) {
        fail(error, { json, payload: { generated: false } });
      }
    });

  project
    .command('link [a] [b] [c]')
    .description('Registra o vínculo 1:1 entre um incremento e uma change nativa')
    .option('--json', 'Saída em JSON')
    .action(async function (this: Command, a?: string, b?: string, c?: string) {
      const json = wantsJson(this);
      try {
        const [planId, changeId, changeName] = c ? [a, b, c] : [undefined, a, b];
        if (!changeId || !changeName) {
          throw new SpecError('Uso: specs project link <change-id> <change-name>', {
            code: 'invalid_option',
          });
        }
        const workspace = await requireWorkspace();
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const result = await linkChange(workspace, id, changeId, changeName);
        if (json) printJson(result);
        else printLines([`Vínculo ${result.id} → ${result.change} (execução: ${result.execution})`]);
      } catch (error) {
        fail(error, { json, payload: { linked: false } });
      }
    });

  project
    .command('unlink [a] [b]')
    .description('Remove o vínculo de um incremento')
    .option('--force', 'Permite remover mesmo com execução observada archived')
    .option('--json', 'Saída em JSON')
    .action(async function (this: Command, a: string | undefined, b: string | undefined, options: { force?: boolean }) {
      const json = wantsJson(this);
      try {
        const [planId, changeId] = b ? [a, b] : [undefined, a];
        if (!changeId) {
          throw new SpecError('Uso: specs project unlink <change-id>', { code: 'invalid_option' });
        }
        const workspace = await requireWorkspace();
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const result = await unlinkChange(workspace, id, changeId, { force: options.force });
        if (json) printJson(result);
        else printLines([`Vínculo de ${result.id} (${result.change}) removido.`]);
      } catch (error) {
        fail(error, { json, payload: { unlinked: false } });
      }
    });

  project
    .command('adopt [a] [b]')
    .description('Cria uma Project Change a partir de uma change existente fora do plano')
    .option('--json', 'Saída em JSON')
    .action(async function (this: Command, a?: string, b?: string) {
      const json = wantsJson(this);
      try {
        const [planId, target] = b ? [a, b] : [undefined, a];
        if (!target) {
          throw new SpecError('Uso: specs project adopt <change-name|archive-dir>', {
            code: 'invalid_option',
          });
        }
        const workspace = await requireWorkspace();
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const result = await adoptChange(workspace, id, target);
        if (json) printJson(result);
        else printLines([`${result.id} adotado a partir de "${result.change}" — ${result.title}`]);
      } catch (error) {
        fail(error, { json, payload: { adopted: false } });
      }
    });

  project
    .command('sync [plan-id]')
    .description('Reconcilia os vínculos com spec/changes/ e o archive')
    .option('--check', 'Reporta o que mudaria sem escrever')
    .option(
      '--link',
      'Vincula incrementos sem vínculo a uma change de MESMO nome do slug, ativa ou arquivada'
    )
    .option('--json', 'Saída em JSON')
    .action(async function (
      this: Command,
      planId: string | undefined,
      options: { check?: boolean; link?: boolean }
    ) {
      const json = wantsJson(this);
      try {
        const workspace = await requireWorkspace();
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const result = await syncPlan(workspace, id, { check: options.check, link: options.link });
        if (json) printJson(result);
        else
          printLines([
            options.check ? 'Prévia da sincronização:' : `Sincronizado (revisão ${result.revision}).`,
            ...result.linked.map(
              (entry) =>
                `  vinculado: ${entry.id} → ${entry.change}` +
                (entry.archivePath ? ' (arquivada)' : '')
            ),
            ...result.resolved.map((entry) => `  archive: ${entry.id} → ${entry.archivePath}`),
            ...result.cleared.map((entry) => `  active limpo: ${entry}`),
            ...result.diagnostics.map((d) => `  ${d.level} ${d.code} — ${d.message}`),
          ]);
      } catch (error) {
        fail(error, { json, payload: { synced: false } });
      }
    });

  project
    .command('set-state [a] [b] [c]')
    .description('Aplica uma transição de planning_state validada contra a máquina de estados')
    .option('--reason <texto>', 'Motivo (obrigatório para on_hold e cancelled)')
    .option('--json', 'Saída em JSON')
    .action(async function (this: Command, a: string | undefined, b: string | undefined, c: string | undefined, options: { reason?: string }) {
      const json = wantsJson(this);
      try {
        const [planId, changeId, state] = c ? [a, b, c] : [undefined, a, b];
        if (!changeId || !state) {
          throw new SpecError('Uso: specs project set-state <change-id> <state> [--reason]', {
            code: 'invalid_option',
          });
        }
        if (!(PLANNING_STATES as readonly string[]).includes(state)) {
          throw new SpecError(
            `"${state}" não é um planning_state. Use: ${PLANNING_STATES.join(', ')}.`,
            { code: 'invalid_transition' }
          );
        }
        const workspace = await requireWorkspace();
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const result = await setPlanningState(
          workspace,
          id,
          changeId,
          state as PlanningState,
          options.reason
        );
        if (json) printJson(result);
        else printLines([`${result.id}: ${result.from} → ${result.to} (revisão ${result.revision})`]);
      } catch (error) {
        fail(error, { json, payload: { id: null } });
      }
    });

  // The bundle contract has to be reachable from inside any project that merely
  // installs specwright: without it an assistant reverse-engineers the schema by
  // probing `apply --dry-run` with broken payloads.
  project
    .command('bundle-schema')
    .description('Imprime o contrato do bundle aceito por `specs project apply`')
    .option('--json', 'Saída em JSON')
    .action(async function (this: Command) {
      const json = wantsJson(this);
      try {
        const contract = bundleContract(BUNDLE_VERSION);
        if (json) printJson(contract);
        else printLines(renderBundleContract(contract));
      } catch (error) {
        fail(error, { json });
      }
    });

  project
    .command('apply [plan-id]')
    .description('Lê um bundle JSON do stdin ou de --file, valida o estado proposto e grava')
    .option('--file <path>', 'Lê o bundle deste arquivo em vez do stdin')
    .option('--dry-run', 'Imprime diff e impacto sem escrever nada')
    .option('--allow-completed', 'Permite uma operação atingir um incremento concluído')
    .option('--expect-revision <n>', 'Falha se a revisão no disco diferir')
    .option('--json', 'Saída em JSON')
    .action(async function (
      this: Command,
      planId: string | undefined,
      options: { file?: string; dryRun?: boolean; allowCompleted?: boolean; expectRevision?: string }
    ) {
      const json = wantsJson(this);
      try {
        const workspace = await requireWorkspace();
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const raw =
          options.file && options.file !== '-'
            ? await (await import('node:fs/promises')).readFile(options.file, 'utf8')
            : await readStdin();
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new SpecError('O bundle não é JSON válido.', { code: 'invalid_bundle' });
        }
        const result = await applyPlanBundle(workspace, id, parsed, {
          dryRun: options.dryRun,
          allowCompleted: options.allowCompleted,
          expectRevision:
            options.expectRevision !== undefined ? Number(options.expectRevision) : undefined,
        });
        if (json) {
          printJson(result);
          return;
        }
        printLines([
          result.dryRun ? 'Prévia do apply (nada foi escrito):' : `Aplicado (revisão ${result.revision.to}).`,
          ...Object.entries(result.idMap).map(([ref, allocated]) => `  ${ref} → ${allocated}`),
          ...result.written.map((file) => `  + ${file}`),
          ...result.removed.map((file) => `  - ${file}`),
        ]);
      } catch (error) {
        fail(error, { json, payload: { applied: false } });
      }
    });

  project
    .command('impact [plan-id]')
    .description('Impacto estrutural de tocar um ou mais incrementos')
    .option('--change <id...>', 'Incrementos alvo')
    .option('--json', 'Saída em JSON')
    .action(async function (this: Command, planId: string | undefined, options: { change?: string[] }) {
      const json = wantsJson(this);
      try {
        if (!options.change || options.change.length === 0) {
          throw new SpecError('Informe pelo menos um --change <id>.', { code: 'invalid_option' });
        }
        const workspace = await requireWorkspace();
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const result = await computeImpact(workspace, id, options.change);
        if (json) {
          printJson(result);
          return;
        }
        printLines([
          `Alvos: ${result.targets.join(', ')}`,
          `  dependentes: ${result.dependents.join(', ') || '—'}`,
          `  ancestrais: ${result.ancestors.join(', ') || '—'}`,
          `  milestones: ${result.milestones.join(', ') || '—'}`,
          `  capabilities: ${result.sharedCapabilities.join(', ') || '—'}`,
          `  concluídos atingidos: ${result.completedReached.join(', ') || '—'}`,
        ]);
      } catch (error) {
        fail(error, { json, payload: { targets: [] } });
      }
    });

  project
    .command('list')
    .description('Lista os planos existentes com identidade, status e progresso')
    .option('--json', 'Saída em JSON')
    .action(async function (this: Command) {
      const json = wantsJson(this);
      try {
        const workspace = await requireWorkspace();
        const ids = await listPlanIds(workspace.projectRoot);
        const plans = [];
        for (const id of ids) {
          const status = await computeProjectStatus(workspace, id);
          plans.push({
            id,
            name: status.plan.name,
            status: status.plan.status,
            derivedStatus: status.plan.derivedStatus,
            total: status.progress.total,
            archived: status.progress.archived,
            percent: status.progress.percent,
            updatedAt: status.plan.updatedAt,
          });
        }
        if (json) {
          printJson({ plans });
          return;
        }
        printLines(
          plans.length === 0
            ? ['Nenhum plano.']
            : plans.map(
                (plan) =>
                  `  ${plan.id.padEnd(20)} ${plan.derivedStatus.padEnd(10)} ${plan.archived}/${plan.total} (${plan.percent}%)`
              )
        );
      } catch (error) {
        fail(error, { json, payload: { plans: [] } });
      }
    });

  for (const [name, target, needsReason] of [
    ['pause', 'paused', true],
    ['resume', 'active', false],
    ['archive', 'archived', false],
  ] as const) {
    project
      .command(`${name} [plan-id]`)
      .description(`Move o plano para o estado "${target}"`)
      .option('--reason <texto>', 'Motivo', undefined)
      .option('--json', 'Saída em JSON')
      .action(async function (this: Command, planId: string | undefined, options: { reason?: string }) {
        const json = wantsJson(this);
        try {
          if (needsReason && !options.reason?.trim()) {
            throw new SpecError(`specs project ${name} exige --reason.`, {
              code: 'missing_reason',
              fix: `specs project ${name} --reason "<texto>"`,
            });
          }
          const workspace = await requireWorkspace();
          const id = await resolvePlanId(workspace.projectRoot, planId);
          const { manifest, paths } = await loadPlan(workspace.projectRoot, id);
          const next = await savePlan(paths, {
            ...manifest,
            status: target as PlanStatusValue,
          });
          const payload = { plan: id, status: next.status, revision: next.revision };
          if (json) printJson(payload);
          else printLines([`Plano "${id}" agora em ${next.status} (revisão ${next.revision}).`]);
        } catch (error) {
          fail(error, { json, payload: { plan: null } });
        }
      });
  }
}

function formatReports(reports: ValidationReport[], valid: boolean): string[] {
  if (reports.length === 0) return ['Nada a validar.'];
  const lines: string[] = [];
  for (const report of reports) {
    lines.push(`${report.type} ${report.item}: ${report.valid ? 'ok' : 'FALHOU'}`);
    for (const issue of report.issues) {
      const where = issue.line ? `${issue.path}:${issue.line}` : issue.path;
      lines.push(`  ${issue.level.padEnd(7)} ${where} - ${issue.message}`);
    }
  }
  lines.push('', valid ? 'Todas as checagens passaram.' : 'Validação falhou.');
  return lines;
}

function formatNext(recommendation: ReturnType<typeof recommendNext>): string[] {
  const lines: string[] = [];
  if (recommendation.recommended) {
    const r = recommendation.recommended;
    lines.push(
      `Próximo: ${r.id} — ${r.title}`,
      `  razões: ${r.reasonCodes.join(', ')}`,
      `  desbloqueia: ${r.unlocks.join(', ') || '—'}`,
      `  comece com: ${r.startWith}`,
      `  depois: ${r.thenLink}`
    );
  } else {
    lines.push('Nenhum incremento pronto.');
  }
  if (recommendation.alternatives.length > 0) {
    lines.push('', 'Alternativas:');
    for (const alternative of recommendation.alternatives) {
      lines.push(`  ${alternative.id} — ${alternative.title} (${alternative.priority})`);
    }
  }
  if (recommendation.parallelReady.length > 1) {
    lines.push(
      '',
      `Paralelas prontas: ${recommendation.parallelReady.join(', ')}`,
      `  ${recommendation.parallelCaveat}`
    );
  }
  if (recommendation.excluded.length > 0) {
    lines.push('', 'Excluídas:');
    for (const excluded of recommendation.excluded) {
      lines.push(`  ${excluded.id} — ${excluded.readiness}: ${excluded.reasonCodes.join(', ')}`);
    }
  }
  return lines;
}
