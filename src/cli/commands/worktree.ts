import type { Command } from 'commander';
import { requireWorkspace } from '../../core/workspace.js';
import { resolveChangeId } from '../../core/change/status.js';
import {
  cleanupWorktree,
  createWorktree,
  finishWorktree,
  listWorktrees,
  resumeWorktree,
} from '../../core/change/worktree.js';
import { fail, printJson, printLines } from '../output.js';

interface BaseOptions {
  change?: string;
  json?: boolean;
}

interface CreateOptions extends BaseOptions {
  task: string;
  link?: string;
}

interface TaskOptions extends BaseOptions {
  task: string;
}

interface CleanupOptions extends BaseOptions {
  task?: string;
  force?: boolean;
}

export function registerWorktreeCommands(program: Command): void {
  const worktree = program
    .command('worktree')
    .description('Isola cada tarefa de um lote paralelo num git worktree próprio');

  worktree
    .command('create')
    .description('Cria um worktree e um branch efêmero para uma tarefa')
    .requiredOption('--task <numero>', 'Número da tarefa')
    .option('--change <id>', 'Change a que a tarefa pertence')
    .option('--link <caminhos>', 'Caminhos (separados por vírgula) para linkar por symlink no worktree novo')
    .option('--json', 'Saída em JSON')
    .action(async (options: CreateOptions) => {
      try {
        const workspace = await requireWorkspace();
        const changeId = await resolveChangeId(workspace, options.change);
        const link = options.link
          ? options.link.split(',').map((entry) => entry.trim()).filter(Boolean)
          : undefined;
        const result = await createWorktree(workspace, changeId, options.task, { link });

        if (options.json) {
          printJson({ change: changeId, ...result });
          return;
        }
        printLines([`Worktree criado para a tarefa ${options.task}: ${result.path} (branch ${result.branch})`]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });

  worktree
    .command('finish')
    .description('Mescla o branch da tarefa de volta na árvore principal e marca o checklist')
    .requiredOption('--task <numero>', 'Número da tarefa')
    .option('--change <id>', 'Change a que a tarefa pertence')
    .option('--json', 'Saída em JSON')
    .action(async (options: TaskOptions) => {
      try {
        const workspace = await requireWorkspace();
        const changeId = await resolveChangeId(workspace, options.change);
        const result = await finishWorktree(workspace, changeId, options.task);

        if (options.json) {
          printJson({ change: changeId, task: options.task, ...result });
          return;
        }
        printLines(
          result.merged
            ? [`Tarefa ${options.task} mesclada e concluída. Restam: ${result.remaining}`]
            : [
                `Conflito ao mesclar a tarefa ${options.task}.`,
                `  worktree: ${result.path}`,
                `  branch:   ${result.branch}`,
                'Resolva manualmente na árvore principal e rode: specs worktree resume',
              ]
        );
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });

  worktree
    .command('resume')
    .description('Fecha a finalização de uma tarefa cujo merge foi resolvido manualmente após um conflito')
    .requiredOption('--task <numero>', 'Número da tarefa')
    .option('--change <id>', 'Change a que a tarefa pertence')
    .option('--json', 'Saída em JSON')
    .action(async (options: TaskOptions) => {
      try {
        const workspace = await requireWorkspace();
        const changeId = await resolveChangeId(workspace, options.change);
        const result = await resumeWorktree(workspace, changeId, options.task);

        if (options.json) {
          printJson({ change: changeId, task: options.task, ...result });
          return;
        }
        printLines([`Tarefa ${options.task} finalizada após resolução manual. Restam: ${result.remaining}`]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });

  worktree
    .command('list')
    .description('Lista os worktrees ativos de uma change')
    .option('--change <id>', 'Change a inspecionar')
    .option('--json', 'Saída em JSON')
    .action(async (options: BaseOptions) => {
      try {
        const workspace = await requireWorkspace();
        const changeId = await resolveChangeId(workspace, options.change);
        const result = await listWorktrees(workspace, changeId);

        if (options.json) {
          printJson({ change: changeId, ...result });
          return;
        }
        printLines([
          ...(result.worktrees.length > 0
            ? result.worktrees.map(
                (entry) => `  ${entry.task.padEnd(8)} ${entry.status.padEnd(16)} ${entry.path}`
              )
            : ['Nenhum worktree registrado.']),
          ...(result.unregistered.length > 0
            ? [
                '',
                'Worktrees sem registro (não removidos automaticamente):',
                ...result.unregistered.map((entry) => `  ${entry.path}`),
              ]
            : []),
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });

  worktree
    .command('cleanup')
    .description('Remove worktrees já mesclados; --force remove independente do estado')
    .option('--change <id>', 'Change a limpar')
    .option('--task <numero>', 'Restringe a uma tarefa')
    .option('--force', 'Remove mesmo sem merge - só com confirmação humana explícita, nunca de um prompt sozinho')
    .option('--json', 'Saída em JSON')
    .action(async (options: CleanupOptions) => {
      try {
        const workspace = await requireWorkspace();
        const changeId = await resolveChangeId(workspace, options.change);
        const result = await cleanupWorktree(workspace, changeId, { task: options.task, force: options.force });

        if (options.json) {
          printJson({ change: changeId, ...result });
          return;
        }
        printLines([
          `Removidos: ${result.removed.join(', ') || 'nenhum'}`,
          ...(result.skipped.length > 0
            ? [`Ignorados: ${result.skipped.map((entry) => `${entry.task} (${entry.reason})`).join(', ')}`]
            : []),
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });
}
