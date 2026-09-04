import type { Command } from 'commander';
import { SpecError } from '../../util/errors.js';
import { createChange } from '../../core/change/create.js';
import { adviseLink, soleCandidate } from '../../core/project/advice.js';
import { computeStatus, resolveChangeContext } from '../../core/change/status.js';
import { buildInstructions, RESERVED_INSTRUCTION_IDS } from '../../core/change/instructions.js';
import { archiveChange } from '../../core/archive/archive.js';
import { listSchemas, loadSchema, templatePath } from '../../core/schema/loader.js';
import { loadConfig } from '../../core/config.js';
import { findWorkspace, listChanges, requireWorkspace, type Workspace } from '../../core/workspace.js';
import { commandName } from '../../core/workflows/index.js';
import { fail, printJson, printLines } from '../output.js';
import { buildDashboard } from '../../core/dashboard.js';
import { renderDashboard, type ViewOptions } from '../dashboard-view.js';
import { CHANGES_TAB, runPanel } from '../panel.js';

/** Resolves the change to act on: the explicit one, or the only active one. */
async function resolveChangeId(
  workspace: Awaited<ReturnType<typeof requireWorkspace>>,
  explicit?: string
): Promise<string> {
  if (explicit) return explicit;

  const active = await listChanges(workspace);
  if (active.length === 1) return active[0];
  if (active.length === 0) {
    throw new SpecError('Nenhuma change ativa', { code: 'no_active_change', fix: 'specs new change <nome>' });
  }
  throw new SpecError(
    `Várias changes ativas: ${active.join(', ')}. Diga qual delas.`,
    { code: 'ambiguous_change' }
  );
}

interface StatusOptions {
  change?: string;
  all?: boolean;
  schema?: string;
  json?: boolean;
  watch?: boolean;
  interval?: string;
  /** Commander sets this to false when --no-color is passed. */
  color?: boolean;
}

/** The colour decision, in the order a terminal tool is expected to make it. */
function viewOptions(options: StatusOptions): ViewOptions {
  return {
    color: options.color !== false && !process.env.NO_COLOR && Boolean(process.stdout.isTTY),
    width: process.stdout.columns ?? 80,
  };
}

function intervalMs(raw: string | undefined): number {
  const seconds = Number(raw ?? '2');
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new SpecError(`"${raw}" não é um intervalo válido. Use um número de segundos maior que zero.`, {
      code: 'invalid_interval',
    });
  }
  return Math.round(seconds * 1000);
}

async function runWatch(workspace: Workspace, options: StatusOptions): Promise<void> {
  if (options.json) {
    throw new SpecError('--watch não pode ser combinado com --json', {
      code: 'invalid_option',
      fix: 'specs status --json',
    });
  }
  if (options.change || options.all) {
    throw new SpecError('--watch redesenha o painel do projeto, então não aceita --change nem --all', {
      code: 'invalid_option',
      fix: 'specs status --watch',
    });
  }

  // The panel opens on CHANGES, which is the screen this command has always
  // drawn. With no plan it is also the only tab, so nothing about this command
  // changes for a workspace that never opted into planning.
  await runPanel(workspace, {
    initial: CHANGES_TAB,
    intervalMs: intervalMs(options.interval),
    view: viewOptions(options),
  });
}

export function registerWorkflowCommands(program: Command): void {
  const newCommand = program.command('new').description('Cria itens do workspace');

  newCommand
    .command('change <name>')
    .description('Cria um diretório de change preparado para o schema do workflow')
    .option('--schema <name>', 'Schema de workflow a usar')
    .option('--goal <text>', 'Objetivo registrado nos metadados da change')
    .option('--skip-specs', 'Declara que a change não altera nenhum comportamento observável')
    .option('--json', 'Saída em JSON')
    .action(async (name: string, options: { schema?: string; goal?: string; skipSpecs?: boolean; json?: boolean }) => {
      try {
        const workspace = await requireWorkspace();
        const created = await createChange(workspace, name, {
          schema: options.schema,
          goal: options.goal,
          skipSpecs: options.skipSpecs,
        });

        // A change whose name is a planned increment's slug is almost always
        // that increment being started. Saying so here is the only moment the
        // connection is obvious; nothing later in the change lifecycle mentions
        // the plan, and unlinked work is invisible to it even after archiving.
        const advice = await adviseLink(workspace.projectRoot, created.id);
        const only = soleCandidate(advice);

        if (options.json) {
          printJson({
            change: created.id,
            changeRoot: created.dir,
            workspace: workspace.root,
            schema: created.schema,
            next: created.next,
            // `plan` stays the single-candidate shape for compatibility;
            // `plans` carries every candidate when there is more than one, so
            // the caller can see the ambiguity instead of a coin flip (F-02).
            ...(only ? { plan: only } : {}),
            ...(advice.ambiguous ? { plans: advice.candidates } : {}),
          });
          return;
        }

        printLines([
          `Change "${created.id}" criada (schema: ${created.schema})`,
          `  ${created.dir}`,
          ...(only
            ? [`Plano "${only.plan}": ${only.change} planeja este slug. Vincule: ${only.fix}`]
            : []),
          ...(advice.ambiguous
            ? [
                `Mais de um plano planeja este slug; escolha um e vincule à mão:`,
                ...advice.candidates.map(
                  (candidate) => `  ${candidate.plan}: ${candidate.change} — ${candidate.fix}`
                ),
              ]
            : []),
          `Próximo${created.next.length === 1 ? ' artefato' : 's artefatos'}: ${created.next.join(', ')}`,
          `Rode: specs instructions ${created.next[0] ?? '<artefato>'} --change ${created.id} --json`,
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: null } });
      }
    });

  program
    .command('status')
    .description('Mostra o painel do projeto, ou a conclusão dos artefatos de uma change')
    .option('--change <id>', 'Change a reportar')
    .option('--all', 'Reporta todas as changes ativas')
    .option('--schema <name>', 'Sobrescreve o schema')
    .option('--watch', 'Redesenha o painel continuamente até Ctrl+C')
    .option('--interval <segundos>', 'Intervalo do --watch em segundos', '2')
    .option('--no-color', 'Desenha o painel sem cor nem glifos Unicode')
    .option('--json', 'Saída em JSON')
    .action(async (options: StatusOptions) => {
      try {
        const workspace = await requireWorkspace();

        if (options.watch) {
          await runWatch(workspace, options);
          return;
        }

        if (!options.change && !options.all) {
          const dashboard = await buildDashboard(workspace);
          if (options.json) {
            printJson(dashboard);
            return;
          }
          process.stdout.write(renderDashboard(dashboard, viewOptions(options)));
          return;
        }

        if (options.all) {
          const ids = await listChanges(workspace);
          const reports = [];
          for (const id of ids) {
            const context = await resolveChangeContext(workspace, id, { schema: options.schema });
            reports.push(await computeStatus(context));
          }

          if (options.json) {
            printJson({ workspace: workspace.root, changes: reports });
            return;
          }
          if (reports.length === 0) {
            printLines(['Nenhuma change ativa.']);
            return;
          }
          printLines(
            reports.map(
              (report) =>
                `${report.change.padEnd(28)} ${report.ready ? 'pronta' : `bloqueada por ${report.applyBlockedBy.join(', ')}`}` +
                (report.tasks ? `  tarefas ${report.tasks.completed}/${report.tasks.total}` : '')
            )
          );
          return;
        }

        const changeId = await resolveChangeId(workspace, options.change);
        const context = await resolveChangeContext(workspace, changeId, { schema: options.schema });
        const status = await computeStatus(context);

        if (options.json) {
          printJson(status);
          return;
        }

        printLines([
          `Change: ${status.change}   Schema: ${status.schema}`,
          `Local: ${status.changeRoot}`,
          '',
          ...status.artifacts.map(
            (artifact) =>
              `  ${symbolFor(artifact.state)} ${artifact.id.padEnd(12)} ${artifact.state.padEnd(8)}` +
              (artifact.missing.length > 0 ? ` precisa de ${artifact.missing.join(', ')}` : '')
          ),
          '',
          status.tasks
            ? `Tarefas: ${status.tasks.completed}/${status.tasks.total} concluídas`
            : 'Tarefas: ainda não escritas',
          status.ready
            ? `Pronta para implementar. Rode /${commandName('implement')}.`
            : `Bloqueada por: ${status.applyBlockedBy.join(', ')}`,
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: options.all ? { changes: [] } : { change: null } });
      }
    });

  program
    .command('instructions [artifact]')
    .description(`Imprime as instruções de um artefato, ou de ${RESERVED_INSTRUCTION_IDS.join(' / ')}`)
    .option('--change <id>', 'Change a que as instruções se aplicam')
    .option('--schema <name>', 'Sobrescreve o schema')
    .option('--json', 'Saída em JSON')
    .action(async (artifact: string | undefined, options: { change?: string; schema?: string; json?: boolean }) => {
      try {
        const workspace = await requireWorkspace();
        const changeId = await resolveChangeId(workspace, options.change);
        const context = await resolveChangeContext(workspace, changeId, { schema: options.schema });

        if (!artifact) {
          const status = await computeStatus(context);
          const next = status.next[0];
          if (!next) {
            throw new SpecError(
              `Todo artefato de "${changeId}" já foi escrito. Peça as instruções de "implement" ou "archive".`,
              { code: 'no_ready_artifact', fix: `specs instructions implement --change ${changeId}` }
            );
          }
          artifact = next;
        }

        const instructions = await buildInstructions(context, artifact);

        if (options.json) {
          printJson(instructions);
          return;
        }

        if (instructions.kind === 'phase') {
          printLines([
            `Fase: ${instructions.phase}   Change: ${instructions.change}`,
            instructions.blockedBy.length > 0
              ? `Bloqueada por: ${instructions.blockedBy.join(', ')}`
              : 'Todos os artefatos necessários estão prontos.',
            '',
            instructions.instruction,
          ]);
          return;
        }

        printLines([
          `Artefato: ${instructions.artifact}   Change: ${instructions.change}`,
          `Saída: ${instructions.outputPath}${instructions.outputIsPattern ? '  (padrão de caminho)' : ''}`,
          ...(instructions.warning ? ['', `ATENÇÃO: ${instructions.warning}`] : []),
          '',
          instructions.instruction,
          ...(instructions.rules.length > 0
            ? ['', 'Regras do projeto:', ...instructions.rules.map((rule) => `  - ${rule}`)]
            : []),
          '',
          'Template:',
          instructions.template,
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: null } });
      }
    });

  program
    .command('archive [change]')
    .description('Aplica uma change nas specs do workspace e a move para o arquivo')
    .option('--skip-specs', 'Não aplica os deltas de spec')
    .option('--no-validate', 'Arquiva sem validar antes')
    .option('--force', 'Arquiva mesmo com tarefas não marcadas')
    .option('--json', 'Saída em JSON')
    .action(async (change: string | undefined, options: { skipSpecs?: boolean; validate?: boolean; force?: boolean; json?: boolean }) => {
      try {
        const workspace = await requireWorkspace();
        const changeId = await resolveChangeId(workspace, change);
        const result = await archiveChange(workspace, changeId, {
          skipSpecs: options.skipSpecs,
          validate: options.validate,
          force: options.force,
        });

        if (options.json) {
          printJson(result);
          return;
        }

        printLines([
          `"${result.change}" arquivada como ${result.archivedAs}`,
          ...(result.specsSkipped
            ? ['  Aplicação dos deltas pulada.']
            : [
                `  Criadas:     ${result.createdSpecs.join(', ') || 'nenhuma'}`,
                `  Atualizadas: ${result.updatedSpecs.join(', ') || 'nenhuma'}`,
                `  Aposentadas: ${result.retiredSpecs.join(', ') || 'nenhuma'}`,
              ]),
          ...(result.plan
            ? [`  Plano "${result.plan.plan}": ${result.plan.change} vinculado e concluído.`]
            : []),
          ...(result.planAmbiguity
            ? [
                '  Mais de um incremento planejava este slug; nada foi gravado no plano.',
                ...result.planAmbiguity.candidates.map(
                  (candidate) => `    ${candidate.plan}: ${candidate.change} — ${candidate.fix}`
                ),
              ]
            : []),
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: null } });
      }
    });

  program
    .command('schemas')
    .description('Lista os schemas de workflow disponíveis')
    .option('--json', 'Saída em JSON')
    .action(async (options: { json?: boolean }) => {
      try {
        const workspace = await findWorkspace();
        const schemas = await listSchemas(workspace);
        const active = workspace ? (await loadConfig(workspace)).schema : undefined;

        if (options.json) {
          printJson({ active: active ?? null, schemas });
          return;
        }

        printLines(
          schemas.map(
            (schema) =>
              `  ${schema.name === active ? '*' : ' '} ${schema.name.padEnd(16)} v${schema.version} ` +
              `[${schema.source}] ${schema.description ?? ''}`
          )
        );
      } catch (error) {
        fail(error, { json: options.json, payload: { schemas: [] } });
      }
    });

  program
    .command('templates')
    .description('Mostra o template a partir do qual cada artefato de um schema é escrito')
    .option('--schema <name>', 'Schema a inspecionar; por padrão, o do workspace')
    .option('--json', 'Saída em JSON')
    .action(async (options: { schema?: string; json?: boolean }) => {
      try {
        const workspace = await findWorkspace();
        const name =
          options.schema ?? (workspace ? (await loadConfig(workspace)).schema : 'spec-driven');
        const schema = await loadSchema(name, workspace);
        const entries = schema.file.artifacts.map((artifact) => ({
          artifact: artifact.id,
          template: templatePath(schema, artifact.template),
          generates: artifact.generates,
        }));

        if (options.json) {
          printJson({ schema: schema.name, source: schema.source, artifacts: entries });
          return;
        }

        printLines([
          `Schema: ${schema.name} (${schema.source})`,
          ...entries.map((entry) => `  ${entry.artifact.padEnd(12)} ${entry.generates.padEnd(18)} ${entry.template}`),
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { schema: null, artifacts: [] } });
      }
    });
}

function symbolFor(state: string): string {
  return state === 'done' ? 'x' : state === 'skipped' ? '-' : state === 'ready' ? '>' : '.';
}
