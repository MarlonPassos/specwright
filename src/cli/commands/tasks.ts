import type { Command } from 'commander';
import { SpecError } from '../../util/errors.js';
import { requireWorkspace } from '../../core/workspace.js';
import { resolveChangeContext, resolveChangeId } from '../../core/change/status.js';
import { markTaskDone, readTaskProgress } from '../../core/change/model.js';
import { DEFAULT_BATCH_LIMIT, TaskGraph, type TaskNode } from '../../core/change/taskGraph.js';
import { assertMainWorktree } from '../../core/change/worktree.js';
import { fail, printJson, printLines } from '../output.js';

interface TasksReadyOptions {
  change?: string;
  limit?: string;
  json?: boolean;
}

interface TasksCompleteOptions {
  change?: string;
  task?: string;
  json?: boolean;
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_BATCH_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new SpecError(`"${raw}" não é um limite válido. Use um inteiro maior que zero.`, {
      code: 'invalid_limit',
    });
  }
  return value;
}

function taskEntry(task: TaskNode) {
  return { number: task.number, text: task.text, files: task.files, dependsOn: task.dependsOn };
}

export function registerTaskCommands(program: Command): void {
  const tasks = program.command('tasks').description('Agendamento de tarefas para dispatch paralelo isolado por worktree');

  tasks
    .command('ready')
    .description('Mostra o próximo lote de tarefas prontas, sem conflito de arquivo declarado entre si')
    .option('--change <id>', 'Change a inspecionar')
    .option('--limit <n>', `Máximo de tarefas no lote (padrão ${DEFAULT_BATCH_LIMIT})`)
    .option('--json', 'Saída em JSON')
    .action(async (options: TasksReadyOptions) => {
      try {
        const workspace = await requireWorkspace();
        await assertMainWorktree(workspace.projectRoot);
        const changeId = await resolveChangeId(workspace, options.change);
        const context = await resolveChangeContext(workspace, changeId);
        const limit = parseLimit(options.limit);

        const progress = await readTaskProgress(context.dir);
        if (!progress) {
          const empty = { change: changeId, batch: [], deferred: [], remaining: 0 };
          if (options.json) {
            printJson(empty);
          } else {
            printLines([`Change "${changeId}" ainda não tem tasks.md.`]);
          }
          return;
        }

        const graph = TaskGraph.from(progress.tasks);
        const { batch, deferred } = graph.nextBatch(limit);
        const remaining = progress.total - progress.completed;

        const result = {
          change: changeId,
          batch: batch.map(taskEntry),
          deferred: deferred.map(({ task, reason }) => ({ number: task.number, text: task.text, reason })),
          remaining,
        };

        if (options.json) {
          printJson(result);
          return;
        }

        printLines([
          `Change: ${changeId}`,
          batch.length > 0
            ? `Lote pronto (${batch.length}): ${batch.map((task) => task.number).join(', ')}`
            : 'Nenhuma tarefa pronta agora.',
          ...(deferred.length > 0
            ? [`Adiadas: ${deferred.map((entry) => `${entry.task.number} (${entry.reason})`).join(', ')}`]
            : []),
          `Restam: ${remaining}`,
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });

  tasks
    .command('complete')
    .description('Marca uma tarefa concluída em tasks.md')
    .requiredOption('--task <numero>', 'Número da tarefa a marcar')
    .option('--change <id>', 'Change a que a tarefa pertence')
    .option('--json', 'Saída em JSON')
    .action(async (options: TasksCompleteOptions) => {
      try {
        const workspace = await requireWorkspace();
        await assertMainWorktree(workspace.projectRoot);
        const changeId = await resolveChangeId(workspace, options.change);
        const context = await resolveChangeContext(workspace, changeId);

        await markTaskDone(context.dir, options.task!);
        const progress = await readTaskProgress(context.dir);
        const remaining = progress ? progress.total - progress.completed : 0;

        const result = { change: changeId, task: options.task, done: true, remaining };

        if (options.json) {
          printJson(result);
          return;
        }
        printLines([`Tarefa ${options.task} marcada em ${changeId}. Restam: ${remaining}`]);
      } catch (error) {
        fail(error, { json: options.json, payload: { change: options.change ?? null } });
      }
    });
}
