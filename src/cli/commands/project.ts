import type { Command } from 'commander';
import { requireWorkspace } from '../../core/workspace.js';
import { createPlan } from '../../core/project/create.js';
import { validatePlan } from '../../core/project/validate.js';
import { resolvePlanId, listPlanIds } from '../../core/project/paths.js';
import type { ValidationReport } from '../../core/validate/report.js';
import { fail, printJson, printLines } from '../output.js';

export function registerProjectCommands(program: Command): void {
  const project = program
    .command('project')
    .description('Planejamento de projeto: decompõe um documento grande em incrementos ordenados')
    .action(async () => {
      // Phase 1 has no dashboard yet; point at what does exist.
      try {
        const workspace = await requireWorkspace();
        const ids = await listPlanIds(workspace.projectRoot);
        printLines(
          ids.length === 0
            ? [
                'Nenhum plano ainda.',
                'Crie um com: specs project create <plan-id> [fontes...]',
              ]
            : [
                'Planos:',
                ...ids.map((id) => `  ${id}`),
                '',
                'Valide um com: specs project validate <plan-id>',
              ]
        );
      } catch (error) {
        fail(error, {});
      }
    });

  project
    .command('create <plan-id> [sources...]')
    .description('Cria planning/<plan-id>/ com plan.yaml (draft), plan.md, architecture.md e planned-changes/')
    .option('--name <nome>', 'Nome humano do plano')
    .option('--owner <nome>', 'Responsável pelo plano')
    .option('--json', 'Saída em JSON')
    .action(
      async (
        planId: string,
        sources: string[],
        options: { name?: string; owner?: string; json?: boolean }
      ) => {
        try {
          const workspace = await requireWorkspace();
          const result = await createPlan(workspace.projectRoot, planId, {
            name: options.name,
            owner: options.owner,
            sources,
          });

          if (options.json) {
            printJson({
              plan: result.plan,
              path: result.path,
              revision: result.revision,
              created: result.created,
            });
            return;
          }

          printLines([
            `Plano "${result.plan}" criado em ${result.path}`,
            ...result.created.map((file) => `  + ${file}`),
          ]);
        } catch (error) {
          fail(error, { json: options.json, payload: { plan: null } });
        }
      }
    );

  project
    .command('validate [plan-id]')
    .description('Valida o manifesto, os Planned Changes, as fontes e os vínculos')
    .option('--strict', 'Trata warnings como falhas')
    .option('--json', 'Saída em JSON')
    .action(async (planId: string | undefined, options: { strict?: boolean; json?: boolean }) => {
      try {
        const workspace = await requireWorkspace();
        const strict = options.strict === true;
        const id = await resolvePlanId(workspace.projectRoot, planId);
        const reports = await validatePlan(workspace.projectRoot, id, { strict });
        const valid = reports.every((report) => report.valid);

        if (options.json) {
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
        fail(error, { json: options.json, payload: { valid: false, reports: [] } });
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
