import type { Command } from 'commander';
import { SpecError } from '../../util/errors.js';
import { createChange } from '../../core/change/create.js';
import { computeStatus, resolveChangeContext } from '../../core/change/status.js';
import { buildInstructions, RESERVED_INSTRUCTION_IDS } from '../../core/change/instructions.js';
import { archiveChange } from '../../core/archive/archive.js';
import { listSchemas, loadSchema, templatePath } from '../../core/schema/loader.js';
import { loadConfig } from '../../core/config.js';
import { findWorkspace, listChanges, requireWorkspace } from '../../core/workspace.js';
import { commandName } from '../../core/workflows/index.js';
import { fail, printJson, printLines } from '../output.js';

/** Resolves the change to act on: the explicit one, or the only active one. */
async function resolveChangeId(
  workspace: Awaited<ReturnType<typeof requireWorkspace>>,
  explicit?: string
): Promise<string> {
  if (explicit) return explicit;

  const active = await listChanges(workspace);
  if (active.length === 1) return active[0];
  if (active.length === 0) {
    throw new SpecError('No active change', { code: 'no_active_change', fix: 'specs new change <name>' });
  }
  throw new SpecError(
    `Several active changes: ${active.join(', ')}. Name the one you mean.`,
    { code: 'ambiguous_change' }
  );
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

        if (options.json) {
          printJson({
            change: created.id,
            changeRoot: created.dir,
            workspace: workspace.root,
            schema: created.schema,
            next: created.next,
          });
          return;
        }

        printLines([
          `Created change "${created.id}" (schema: ${created.schema})`,
          `  ${created.dir}`,
          `Next artifact${created.next.length === 1 ? '' : 's'}: ${created.next.join(', ')}`,
          `Run: specs instructions ${created.next[0] ?? '<artifact>'} --change ${created.id} --json`,
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: null } });
      }
    });

  program
    .command('status')
    .description('Mostra a conclusão dos artefatos de uma change')
    .option('--change <id>', 'Change a reportar')
    .option('--all', 'Reporta todas as changes ativas')
    .option('--schema <name>', 'Sobrescreve o schema')
    .option('--json', 'Saída em JSON')
    .action(async (options: { change?: string; all?: boolean; schema?: string; json?: boolean }) => {
      try {
        const workspace = await requireWorkspace();

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
            printLines(['No active changes.']);
            return;
          }
          printLines(
            reports.map(
              (report) =>
                `${report.change.padEnd(28)} ${report.ready ? 'ready' : `blocked by ${report.applyBlockedBy.join(', ')}`}` +
                (report.tasks ? `  tasks ${report.tasks.completed}/${report.tasks.total}` : '')
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
          `Location: ${status.changeRoot}`,
          '',
          ...status.artifacts.map(
            (artifact) =>
              `  ${symbolFor(artifact.state)} ${artifact.id.padEnd(12)} ${artifact.state.padEnd(8)}` +
              (artifact.missing.length > 0 ? ` needs ${artifact.missing.join(', ')}` : '')
          ),
          '',
          status.tasks ? `Tasks: ${status.tasks.completed}/${status.tasks.total} complete` : 'Tasks: not written yet',
          status.ready
            ? `Ready to implement. Run /${commandName('implement')}.`
            : `Blocked by: ${status.applyBlockedBy.join(', ')}`,
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
              `Every artifact of "${changeId}" is written. Ask for "implement" or "archive" instructions.`,
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
            `Phase: ${instructions.phase}   Change: ${instructions.change}`,
            instructions.blockedBy.length > 0
              ? `Blocked by: ${instructions.blockedBy.join(', ')}`
              : 'All required artifacts are in place.',
            '',
            instructions.instruction,
          ]);
          return;
        }

        printLines([
          `Artifact: ${instructions.artifact}   Change: ${instructions.change}`,
          `Output: ${instructions.outputPath}${instructions.outputIsPattern ? '  (pattern)' : ''}`,
          ...(instructions.warning ? ['', `WARNING: ${instructions.warning}`] : []),
          '',
          instructions.instruction,
          ...(instructions.rules.length > 0
            ? ['', 'Project rules:', ...instructions.rules.map((rule) => `  - ${rule}`)]
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
          `Archived "${result.change}" as ${result.archivedAs}`,
          ...(result.specsSkipped
            ? ['  Spec merge skipped.']
            : [
                `  Created: ${result.createdSpecs.join(', ') || 'none'}`,
                `  Updated: ${result.updatedSpecs.join(', ') || 'none'}`,
                `  Retired: ${result.retiredSpecs.join(', ') || 'none'}`,
              ]),
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
