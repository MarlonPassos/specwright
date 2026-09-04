import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, Help } from 'commander';
import { registerSetupCommands } from './commands/setup.js';
import { registerWorkflowCommands } from './commands/workflow.js';
import { registerInspectCommands } from './commands/inspect.js';
import { registerProjectCommands } from './commands/project.js';
import { registerWatchCommands } from './commands/watch.js';
import { registerServeCommand } from './commands/serve.js';
import { registerTaskCommands } from './commands/tasks.js';
import { registerWorktreeCommands } from './commands/worktree.js';

async function readVersion(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    path.join(here, '..', '..', 'package.json'),
    path.join(here, '..', '..', '..', 'package.json'),
  ]) {
    try {
      return JSON.parse(await readFile(candidate, 'utf8')).version as string;
    } catch {
      continue;
    }
  }
  return '0.0.0';
}

/**
 * Commander writes its own help wording in English and offers no hook to replace it.
 * The terms below are translated where each one is produced: the command and usage
 * terms through the help configuration, so the column widths are measured on the
 * translated text, and the section headings on the way out. Only help and version
 * output passes through here; every command prints its result with console.log.
 */
const HELP_TERMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Usage:/gm, 'Uso:'],
  [/^Arguments:$/gm, 'Argumentos:'],
  [/^Options:$/gm, 'Opções:'],
  [/^Commands:$/gm, 'Comandos:'],
  [/\[options\]/g, '[opções]'],
  [/\[command\]/g, '[comando]'],
  [/\(default: /g, '(padrão: '],
];

function translateHelp(text: string): string {
  return HELP_TERMS.reduce((output, [term, translation]) => output.replace(term, translation), text);
}

/** Commander's untranslated help, to build the translated terms from. */
const defaultHelp = new Help();

export async function buildProgram(): Promise<Command> {
  const program = new Command();

  program
    .name('specs')
    .description('Desenvolvimento orientado a especificações para harnesses de código com IA')
    .version(await readVersion(), '-V, --version', 'Mostra a versão')
    .helpOption('-h, --help', 'Mostra a ajuda do comando')
    .addHelpCommand('help [command]', 'Mostra a ajuda de um comando')
    .configureHelp({
      subcommandTerm: (cmd) => translateHelp(defaultHelp.subcommandTerm(cmd)),
      commandUsage: (cmd) => translateHelp(defaultHelp.commandUsage(cmd)),
    })
    .configureOutput({
      writeOut: (text) => process.stdout.write(translateHelp(text)),
      writeErr: (text) => process.stderr.write(translateHelp(text)),
    });

  registerSetupCommands(program);
  registerWorkflowCommands(program);
  registerInspectCommands(program);
  registerProjectCommands(program);
  registerWatchCommands(program);
  registerServeCommand(program);
  registerTaskCommands(program);
  registerWorktreeCommands(program);

  return program;
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = await buildProgram();
  await program.parseAsync(argv);
}
