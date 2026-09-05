import type { Command } from 'commander';
import { requireWorkspace } from '../../core/workspace.js';
import { resolveChangeId } from '../../core/change/status.js';
import {
  cleanupChangeWorktree,
  cleanupWorktree,
  createChangeWorktree,
  createWorktree,
  finishChangeWorktree,
  finishWorktree,
  listChangeWorktrees,
  listWorktrees,
  resumeChangeWorktree,
  resumeWorktree,
} from '../../core/change/worktree.js';
import { fail, printJson, printLines } from '../output.js';

interface BaseOptions {
  change?: string;
  json?: boolean;
}

interface CreateOptions extends BaseOptions {
  task?: string;
  link?: string;
}

interface TaskOptions extends BaseOptions {
  task?: string;
}

interface CleanupOptions extends BaseOptions {
  task?: string;
  force?: boolean;
}

export function registerWorktreeCommands(program: Command): void {
  const worktree = program
    .command('worktree')
    .description(
      'Isola uma tarefa ou uma change inteira num git worktree próprio (--task escolhe qual das duas)'
    );

  worktree
    .command('create')
    .description('Cria um worktree e um branch efêmero — para uma tarefa (--task) ou para a change inteira')
    .option('--task <numero>', 'Número da tarefa; omitido, isola a change inteira')
    .option('--change <id>', 'Change a que o worktree pertence')
    .option('--link <caminhos>', 'Caminhos (separados por vírgula) para linkar por symlink no worktree novo')
    .option('--json', 'Saída em JSON')
    .action(async (options: CreateOptions) => {
      try {
        const workspace = await requireWorkspace();
        const changeId = await resolveChangeId(workspace, options.change);
        const link = options.link
          ? options.link.split(',').map((entry) => entry.trim()).filter(Boolean)
          : undefined;

        if (options.task) {
          const result = await createWorktree(workspace, changeId, options.task, { link });
          if (options.json) {
            printJson({ change: changeId, ...result });
            return;
          }
          printLines([`Worktree criado para a tarefa ${options.task}: ${result.path} (branch ${result.branch})`]);
          return;
        }

        const result = await createChangeWorktree(workspace, changeId, { link });
        if (options.json) {
          printJson({ change: changeId, ...result });
          return;
        }
        printLines([`Worktree criado para a change ${changeId}: ${result.path} (branch ${result.branch})`]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });

  worktree
    .command('finish')
    .description(
      'Mescla o branch de volta na árvore principal — de uma tarefa (--task, marca o checklist) ou da change inteira'
    )
    .option('--task <numero>', 'Número da tarefa; omitido, finaliza o worktree da change inteira')
    .option('--change <id>', 'Change a que o worktree pertence')
    .option('--json', 'Saída em JSON')
    .action(async (options: TaskOptions) => {
      try {
        const workspace = await requireWorkspace();
        const changeId = await resolveChangeId(workspace, options.change);

        if (options.task) {
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
          return;
        }

        const result = await finishChangeWorktree(workspace, changeId);
        if (options.json) {
          printJson({ change: changeId, ...result });
          return;
        }
        printLines(
          result.merged
            ? [`Change ${changeId} mesclada.`]
            : [
                `Conflito ao mesclar a change ${changeId}.`,
                `  worktree: ${result.path}`,
                `  branch:   ${result.branch}`,
                'Resolva manualmente na árvore principal e rode: specs worktree resume --change ' + changeId,
              ]
        );
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });

  worktree
    .command('resume')
    .description(
      'Fecha a finalização cujo merge foi resolvido manualmente após um conflito — de uma tarefa (--task) ou da change inteira'
    )
    .option('--task <numero>', 'Número da tarefa; omitido, retoma o worktree da change inteira')
    .option('--change <id>', 'Change a que o worktree pertence')
    .option('--json', 'Saída em JSON')
    .action(async (options: TaskOptions) => {
      try {
        const workspace = await requireWorkspace();
        const changeId = await resolveChangeId(workspace, options.change);

        if (options.task) {
          const result = await resumeWorktree(workspace, changeId, options.task);
          if (options.json) {
            printJson({ change: changeId, task: options.task, ...result });
            return;
          }
          printLines([`Tarefa ${options.task} finalizada após resolução manual. Restam: ${result.remaining}`]);
          return;
        }

        const result = await resumeChangeWorktree(workspace, changeId);
        if (options.json) {
          printJson({ change: changeId, ...result });
          return;
        }
        printLines([`Change ${changeId} finalizada após resolução manual.`]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });

  worktree
    .command('list')
    .description('Lista os worktrees ativos — de uma change (--change) ou de changes inteiras em todo o workspace')
    .option('--change <id>', 'Change a inspecionar (worktrees de tarefa); omitido, lista worktrees de change inteira')
    .option('--json', 'Saída em JSON')
    .action(async (options: BaseOptions) => {
      try {
        const workspace = await requireWorkspace();

        if (options.change) {
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
          return;
        }

        const result = await listChangeWorktrees(workspace);
        if (options.json) {
          printJson({ worktrees: result });
          return;
        }
        printLines(
          result.length > 0
            ? result.map((entry) => `  ${entry.change.padEnd(24)} ${entry.status.padEnd(16)} ${entry.path}`)
            : ['Nenhum worktree de change registrado.']
        );
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });

  worktree
    .command('cleanup')
    .description('Remove worktrees já mesclados; --force remove independente do estado')
    .option('--change <id>', 'Change a limpar')
    .option('--task <numero>', 'Restringe a uma tarefa; com --change e sem --task, limpa o worktree da change inteira')
    .option('--force', 'Remove mesmo sem merge - só com confirmação humana explícita, nunca de um prompt sozinho')
    .option('--json', 'Saída em JSON')
    .action(async (options: CleanupOptions) => {
      try {
        const workspace = await requireWorkspace();
        const changeId = await resolveChangeId(workspace, options.change);

        if (options.task) {
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
          return;
        }

        const result = await cleanupChangeWorktree(workspace, changeId, { force: options.force });
        if (options.json) {
          printJson({ change: changeId, ...result });
          return;
        }
        printLines([
          result.removed ? `Removido o worktree da change ${changeId}.` : `Ignorado (${result.reason}).`,
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });
}
