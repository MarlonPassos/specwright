import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerSetupCommands } from './commands/setup.js';
import { registerWorkflowCommands } from './commands/workflow.js';
import { registerInspectCommands } from './commands/inspect.js';

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

export async function buildProgram(): Promise<Command> {
  const program = new Command();

  program
    .name('specs')
    .description('Spec-driven development workflow for AI coding harnesses')
    .version(await readVersion());

  registerSetupCommands(program);
  registerWorkflowCommands(program);
  registerInspectCommands(program);

  return program;
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = await buildProgram();
  await program.parseAsync(argv);
}
