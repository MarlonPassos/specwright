import type { Command } from 'commander';
import { initWorkspace, updateWorkspace } from '../../core/init.js';
import { allHarnesses, harnessIds } from '../../core/harness/index.js';
import { workflowCommands, commandName } from '../../core/workflows/index.js';
import { requireWorkspace } from '../../core/workspace.js';
import { fail, printJson, printLines } from '../output.js';

export function registerSetupCommands(program: Command): void {
  program
    .command('init [path]')
    .description('Create a workspace and generate the harness commands')
    .option(
      '--harnesses <list>',
      `Harnesses to set up: "all" or a comma-separated list of ${harnessIds().join(', ')}`,
      'all'
    )
    .option('--schema <name>', 'Workflow schema for new changes')
    .option('--json', 'Output as JSON')
    .action(async (target: string | undefined, options: { harnesses?: string; schema?: string; json?: boolean }) => {
      try {
        const result = await initWorkspace(target ?? '.', {
          harnesses: options.harnesses,
          schema: options.schema,
        });

        if (options.json) {
          printJson({
            workspace: result.workspace.root,
            created: result.created,
            schema: result.schema,
            harnesses: result.harnesses,
            commands: workflowCommands().map((command) => commandName(command.id)),
            files: result.files.map((file) => file.path),
          });
          return;
        }

        printLines([
          result.created ? 'Workspace created.' : 'Workspace updated.',
          `  Location: ${result.workspace.root}`,
          `  Schema:   ${result.schema}`,
          `  Harnesses: ${result.harnesses.join(', ')}`,
          '',
          `Generated ${result.files.length} command files:`,
          ...allHarnesses()
            .filter((adapter) => result.harnesses.includes(adapter.id))
            .map((adapter) => `  ${adapter.name.padEnd(12)} ${adapter.directory}`),
          '',
          'Available in every harness:',
          ...workflowCommands().map(
            (command) => `  /${commandName(command.id).padEnd(16)} ${command.description}`
          ),
          '',
          result.projectFileCreated
            ? 'Next: describe the project in spec/project.md, then run /spec-propose.'
            : 'Next: run /spec-propose to open a change.',
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { workspace: null } });
      }
    });

  program
    .command('update [path]')
    .description('Regenerate the harness command files')
    .option('--harnesses <list>', 'Harnesses to (re)generate; defaults to the configured ones')
    .option('--json', 'Output as JSON')
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
          `Regenerated ${result.files.length} command files for: ${result.harnesses.join(', ')}`,
          ...result.files.map((file) => `  ${file.path}`),
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { workspace: null } });
      }
    });

  program
    .command('harnesses')
    .description('List the supported harnesses and the commands generated for them')
    .option('--json', 'Output as JSON')
    .action((options: { json?: boolean }) => {
      const commands = workflowCommands();

      if (options.json) {
        printJson({
          harnesses: allHarnesses().map((adapter) => ({
            id: adapter.id,
            name: adapter.name,
            directory: adapter.directory,
            files: commands.map((command) => adapter.filePath(command.id)),
          })),
          commands: commands.map((command) => ({
            id: command.id,
            invocation: `/${commandName(command.id)}`,
            description: command.description,
          })),
        });
        return;
      }

      printLines([
        'Supported harnesses:',
        ...allHarnesses().map((adapter) => `  ${adapter.id.padEnd(10)} ${adapter.name.padEnd(14)} ${adapter.directory}`),
        '',
        'Commands (identical in every harness):',
        ...commands.map((command) => `  /${commandName(command.id).padEnd(16)} ${command.description}`),
      ]);
    });
}
