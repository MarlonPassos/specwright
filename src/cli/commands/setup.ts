import type { Command } from 'commander';
import { initWorkspace, updateWorkspace } from '../../core/init.js';
import { allHarnesses, detectHarness, harnessIds } from '../../core/harness/index.js';
import { allCommands, commandName } from '../../core/workflows/index.js';
import { requireWorkspace } from '../../core/workspace.js';
import { fail, printJson, printLines } from '../output.js';

export function registerSetupCommands(program: Command): void {
  program
    .command('init [path]')
    .description('Cria o workspace e gera os comandos dos harnesses')
    .option(
      '--harnesses <list>',
      `Harnesses a configurar: "all" ou uma lista separada por vírgula de ${harnessIds().join(', ')}`,
      'all'
    )
    .option('--schema <name>', 'Schema de workflow para novas changes')
    .option('--json', 'Saída em JSON')
    .action(async (target: string | undefined, options: { harnesses?: string; schema?: string; json?: boolean }) => {
      try {
        const result = await initWorkspace(target ?? '.', {
          harnesses: options.harnesses,
          schema: options.schema,
        });

        const harness = detectHarness({ configured: result.harnesses });

        if (options.json) {
          printJson({
            workspace: result.workspace.root,
            created: result.created,
            schema: result.schema,
            harnesses: result.harnesses,
            harness: harness.id,
            commands: allCommands().map((command) => commandName(command.id)),
            files: result.files.map((file) => file.path),
          });
          return;
        }

        printLines([
          result.created ? 'Workspace criado.' : 'Workspace atualizado.',
          `  Local:     ${result.workspace.root}`,
          `  Schema:    ${result.schema}`,
          `  Harnesses: ${result.harnesses.join(', ')}`,
          '',
          `${result.files.length} arquivos de comando gerados:`,
          ...allHarnesses()
            .filter((adapter) => result.harnesses.includes(adapter.id))
            .map(
              (adapter) =>
                `  ${adapter.name.padEnd(12)} ${adapter.directory.padEnd(18)} ex.: ${adapter.invocation('continue')}`
            ),
          '',
          // Named without a prefix: each harness types them the way the table above shows.
          'Comandos gerados:',
          ...allCommands().map(
            (command) => `  ${commandName(command.id).padEnd(16)} ${command.description}`
          ),
          '',
          result.projectFileCreated
            ? `Próximo passo: descreva o projeto em spec/project.md e rode ${harness.invocation('propose')}.`
            : `Próximo passo: rode ${harness.invocation('propose')} para abrir uma change.`,
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { workspace: null } });
      }
    });

  program
    .command('update [path]')
    .description('Regera os arquivos de comando dos harnesses')
    .option('--harnesses <list>', 'Harnesses a (re)gerar; por padrão, os já configurados')
    .option('--json', 'Saída em JSON')
    .action(async (target: string | undefined, options: { harnesses?: string; json?: boolean }) => {
      try {
        const workspace = await requireWorkspace(target ?? process.cwd());
        const result = await updateWorkspace(workspace, { harnesses: options.harnesses });

        if (options.json) {
          printJson({
            workspace: workspace.root,
            harnesses: result.harnesses,
            commands: result.commands.map(commandName),
            files: result.files.map((file) => file.path),
          });
          return;
        }

        printLines([
          `${result.files.length} arquivos de comando regerados para: ${result.harnesses.join(', ')}`,
          ...result.files.map((file) => `  ${file.path}`),
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { workspace: null } });
      }
    });

  program
    .command('harnesses')
    .description('Lista os harnesses suportados e os comandos gerados para eles')
    .option('--json', 'Saída em JSON')
    .action((options: { json?: boolean }) => {
      const commands = allCommands();

      if (options.json) {
        printJson({
          harnesses: allHarnesses().map((adapter) => ({
            id: adapter.id,
            name: adapter.name,
            directory: adapter.directory,
            files: commands.map((command) => adapter.filePath(command.id)),
            invocations: Object.fromEntries(
              commands.map((command) => [command.id, adapter.invocation(command.id)])
            ),
          })),
          commands: commands.map((command) => ({
            id: command.id,
            name: commandName(command.id),
            description: command.description,
          })),
        });
        return;
      }

      printLines([
        'Harnesses suportados:',
        ...allHarnesses().map(
          (adapter) =>
            `  ${adapter.id.padEnd(10)} ${adapter.name.padEnd(14)} ${adapter.directory.padEnd(18)} ex.: ${adapter.invocation('continue')}`
        ),
        '',
        'Comandos (os mesmos em todos os harnesses; a sintaxe de chamada varia, veja acima):',
        ...commands.map((command) => `  ${commandName(command.id).padEnd(16)} ${command.description}`),
      ]);
    });
}
