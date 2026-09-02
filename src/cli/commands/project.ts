import type { Command } from 'commander';
import { SpecError } from '../../util/errors.js';
import { requireWorkspace } from '../../core/workspace.js';
import { createPlan } from '../../core/project/create.js';
import { validatePlan } from '../../core/project/validate.js';
import { resolvePlanId, listPlanIds } from '../../core/project/paths.js';
import { computeProjectStatus, showProjectChange, statusPayload } from '../../core/project/status.js';
import { recommendNext } from '../../core/project/next.js';
import { generatePlannedChanges } from '../../core/project/generate.js';
import type { ValidationReport } from '../../core/validate/report.js';
import { renderProjectDashboard } from '../project-dashboard-view.js';
import { fail, printJson, printLines } from '../output.js';

const DASHBOARD_SCHEMA_VERSION = 1;

/** `--json` for a subcommand: its own flag, or the group's. */
function wantsJson(command: Command): boolean {
  return command.opts().json === true || command.parent?.opts().json === true;
}

export function registerProjectCommands(program: Command): void {
  const project = program
    .command('project')
    .description('Planejamento de projeto: decompõe um documento grande em incrementos ordenados')
    .option('--json', 'Saída em JSON')
    .option('--watch', 'Repinta o dashboard por polling (Fase 5)')
    .action(async function (this: Command, options: { json?: boolean; watch?: boolean }) {
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
        const status = await computeProjectStatus(workspace, id);
        const next = recommendNext(status);

        if (options.json) {
          printJson({
            ...statusPayload(status),
            recommended: next.recommended,
            dashboardSchemaVersion: DASHBOARD_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
          });
          return;
        }
        printLines(renderProjectDashboard(status, next));
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
    .action(async function (this: Command, planId: string | undefined) {
      const json = wantsJson(this);
      try {
        const workspace = await requireWorkspace();
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const status = await computeProjectStatus(workspace, id);
        const next = recommendNext(status);
        if (json) printJson(statusPayload(status));
        else printLines(renderProjectDashboard(status, next));
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
