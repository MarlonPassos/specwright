import type { Command } from 'commander';
import { SpecError } from '../../util/errors.js';
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
  wholeChange?: boolean;
  link?: string;
}

interface TaskOptions extends BaseOptions {
  task?: string;
  wholeChange?: boolean;
}

interface ListOptions extends BaseOptions {
  wholeChange?: boolean;
}

interface CleanupOptions extends BaseOptions {
  task?: string;
  wholeChange?: boolean;
  force?: boolean;
}

/**
 * `--task` and `--whole-change` pick between the two units this module can
 * isolate. Neither has a silent default here: `create`/`finish`/`resume`
 * always required `--task` before whole-change worktrees existed, so a
 * missing flag stays a hard error instead of quietly falling back to
 * whichever unit happens to be "the other one" - the exact ambiguity a typo'd
 * flag name would otherwise fall into.
 */
function requireUnit(options: { task?: string; wholeChange?: boolean }): void {
  if (options.task && options.wholeChange) {
    throw new SpecError('Use --task OU --whole-change, não os dois', { code: 'invalid_worktree_unit' });
  }
  if (!options.task && !options.wholeChange) {
    throw new SpecError('Informe --task <numero> (uma tarefa) ou --whole-change (a change inteira)', {
      code: 'invalid_worktree_unit',
    });
  }
}

export function registerWorktreeCommands(program: Command): void {
  const worktree = program
    .command('worktree')
    .description(
      'Isola uma tarefa (--task) ou uma change inteira (--whole-change) num git worktree próprio'
    );

  worktree
    .command('create')
    .description('Cria um worktree e um branch efêmero — para uma tarefa (--task) ou para a change inteira (--whole-change)')
    .option('--task <numero>', 'Número da tarefa')
    .option('--whole-change', 'Isola a change inteira, não uma tarefa')
    .option('--change <id>', 'Change a que o worktree pertence')
    .option('--link <caminhos>', 'Caminhos (separados por vírgula) para linkar por symlink no worktree novo')
    .option('--json', 'Saída em JSON')
    .action(async (options: CreateOptions) => {
      try {
        requireUnit(options);
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
      'Mescla o branch de volta na árvore principal — de uma tarefa (--task, marca o checklist) ou da change inteira (--whole-change)'
    )
    .option('--task <numero>', 'Número da tarefa')
    .option('--whole-change', 'Finaliza o worktree da change inteira, não uma tarefa')
    .option('--change <id>', 'Change a que o worktree pertence')
    .option('--json', 'Saída em JSON')
    .action(async (options: TaskOptions) => {
      try {
        requireUnit(options);
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
                'Resolva manualmente na árvore principal e rode: specs worktree resume --change ' +
                  changeId +
                  ' --whole-change',
              ]
        );
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });

  worktree
    .command('resume')
    .description(
      'Fecha a finalização cujo merge foi resolvido manualmente após um conflito — de uma tarefa (--task) ou da change inteira (--whole-change)'
    )
    .option('--task <numero>', 'Número da tarefa')
    .option('--whole-change', 'Retoma o worktree da change inteira, não uma tarefa')
    .option('--change <id>', 'Change a que o worktree pertence')
    .option('--json', 'Saída em JSON')
    .action(async (options: TaskOptions) => {
      try {
        requireUnit(options);
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
    .description(
      'Lista os worktrees de tarefa de uma change (padrão) — ou, com --whole-change, os worktrees de change inteira em todo o workspace'
    )
    .option('--change <id>', 'Change a inspecionar (ignorado com --whole-change)')
    .option('--whole-change', 'Lista worktrees de change inteira em vez de tarefas')
    .option('--json', 'Saída em JSON')
    .action(async (options: ListOptions) => {
      try {
        const workspace = await requireWorkspace();

        if (options.wholeChange) {
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
          return;
        }

        // Unchanged from before --whole-change existed: task worktrees of the
        // named (or single active) change.
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
    .option('--whole-change', 'Limpa o worktree da change inteira em vez das tarefas dela')
    .option('--force', 'Remove mesmo sem merge - só com confirmação humana explícita, nunca de um prompt sozinho')
    .option('--json', 'Saída em JSON')
    .action(async (options: CleanupOptions) => {
      try {
        if (options.task && options.wholeChange) {
          throw new SpecError('Use --task OU --whole-change, não os dois', { code: 'invalid_worktree_unit' });
        }
        const workspace = await requireWorkspace();
        const changeId = await resolveChangeId(workspace, options.change);

        if (options.wholeChange) {
          const result = await cleanupChangeWorktree(workspace, changeId, { force: options.force });
          if (options.json) {
            printJson({ change: changeId, ...result });
            return;
          }
          printLines([
            result.removed ? `Removido o worktree da change ${changeId}.` : `Ignorado (${result.reason}).`,
          ]);
          return;
        }

        // Unchanged from before --whole-change existed: task worktrees, all of
        // them unless --task narrows it.
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
