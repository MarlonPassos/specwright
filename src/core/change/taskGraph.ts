import path from 'node:path';
import { SpecError } from '../../util/errors.js';
import type { Task } from './model.js';

/** A task once it has a stable, unique identity - see `TaskGraph.from`. */
export type TaskNode = Task;

export interface DeferredTask {
  task: TaskNode;
  reason: 'conflicts_with_batch_or_over_limit';
}

export interface ReadyBatch {
  batch: TaskNode[];
  deferred: DeferredTask[];
}

/**
 * How many worktrees a single batch opens at once. Kept small and fixed
 * rather than unbounded: even with isolation, nothing is gained by opening
 * more worktrees than a session can realistically dispatch subagents for in
 * one message, and disk/process cost grows with it.
 */
export const DEFAULT_BATCH_LIMIT = 4;

/**
 * The dependency and scheduling graph over one change's tasks.
 *
 * `specs validate` keeps tolerating a duplicated or missing task number as a
 * warning - that check is about document quality, not about whether the
 * checklist can be scheduled. This graph is stricter on purpose: it is only
 * built by commands that need a number to be a stable, unique identity
 * (`specs tasks ready`, the worktree commands), so it refuses to exist at all
 * rather than silently picking one of two same-numbered tasks. A task with no
 * number is simply left out - it stays reachable only through the ordinary,
 * one-at-a-time checklist walk, which never needed individual addressing.
 */
export class TaskGraph {
  private readonly byNumber: Map<string, TaskNode>;

  private constructor(private readonly tasks: TaskNode[]) {
    this.byNumber = new Map(tasks.map((task) => [task.number, task]));
  }

  static from(tasks: Task[]): TaskGraph {
    const numbered = tasks.filter((task) => task.number !== '');
    assertUniqueNumbers(numbered);
    assertKnownDependencies(numbered);
    assertAcyclic(numbered);
    return new TaskGraph(numbered);
  }

  get all(): TaskNode[] {
    return [...this.tasks];
  }

  /** Pending tasks whose declared dependencies are all done. */
  ready(): TaskNode[] {
    return this.tasks.filter(
      (task) => !task.done && task.dependsOn.every((dependency) => this.byNumber.get(dependency)?.done === true)
    );
  }

  /**
   * The next set of ready tasks safe to dispatch together, capped at `limit`.
   *
   * A task that declares no `files:` is included, not excluded - the
   * declaration is a scheduling hint here, not a safety gate. The mechanism
   * that keeps parallel dispatch safe when the hint is missing, wrong, or two
   * tasks conflict for real is the merge step each task's isolated worktree
   * goes through before its checkbox is marked, not this method.
   */
  nextBatch(limit = DEFAULT_BATCH_LIMIT): ReadyBatch {
    const readyTasks = this.ready();
    const batch = selectNonConflictingBatch(readyTasks).slice(0, limit);
    const deferred: DeferredTask[] = readyTasks
      .filter((task) => !batch.includes(task))
      .map((task) => ({ task, reason: 'conflicts_with_batch_or_over_limit' as const }));
    return { batch, deferred };
  }
}

function assertUniqueNumbers(tasks: TaskNode[]): void {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.number)) {
      throw new SpecError(`Número de tarefa duplicado impede o grafo de paralelismo: ${task.number}`, {
        code: 'task_number_duplicate',
        fix: 'specs validate <change> --json — corrija a duplicata em tasks.md',
      });
    }
    seen.add(task.number);
  }
}

export interface UnknownDependency {
  task: TaskNode;
  dependency: string;
}

/**
 * Every `depends:` reference that names a task number absent from `tasks`.
 * Pure and non-throwing so both `TaskGraph.from` (which turns the first one
 * into a hard error) and `specs validate` (which reports every one it finds,
 * never stopping at the first) can share the same detection.
 */
export function findUnknownDependencies(tasks: TaskNode[]): UnknownDependency[] {
  const known = new Set(tasks.map((task) => task.number));
  const found: UnknownDependency[] = [];
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!known.has(dependency)) found.push({ task, dependency });
    }
  }
  return found;
}

/** The first dependency cycle found, as the chain of task numbers, or `undefined` if acyclic. */
export function findDependencyCycle(tasks: TaskNode[]): string[] | undefined {
  const byNumber = new Map(tasks.map((task) => [task.number, task]));
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let found: string[] | undefined;

  const visit = (number: string): void => {
    if (found || onStack.has(number)) {
      if (!found && onStack.has(number)) found = [...stack.slice(stack.indexOf(number)), number];
      return;
    }
    if (visited.has(number)) return;
    visited.add(number);
    onStack.add(number);
    stack.push(number);
    for (const dependency of byNumber.get(number)?.dependsOn ?? []) {
      visit(dependency);
      if (found) break;
    }
    stack.pop();
    onStack.delete(number);
  };

  for (const task of tasks) {
    visit(task.number);
    if (found) break;
  }
  return found;
}

function assertKnownDependencies(tasks: TaskNode[]): void {
  const [first] = findUnknownDependencies(tasks);
  if (first) {
    throw new SpecError(`A tarefa "${first.task.number}" depende de "${first.dependency}", que não existe no checklist`, {
      code: 'task_depends_unknown',
    });
  }
}

function assertAcyclic(tasks: TaskNode[]): void {
  const cycle = findDependencyCycle(tasks);
  if (cycle) {
    throw new SpecError(`Ciclo de dependência entre tarefas: ${cycle.join(' -> ')}`, { code: 'task_depends_cycle' });
  }
}

function normalizePath(value: string): string {
  return value.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
}

function pathsOverlap(a: string, b: string): boolean {
  const [x, y] = [normalizePath(a), normalizePath(b)];
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/**
 * Folds a path down to the file it is really about, so `src/foo.ts` and
 * `test/foo.test.ts` compare equal even though neither path is a prefix of
 * the other.
 */
function moduleKey(value: string): string {
  const normalized = normalizePath(value);
  const withoutPrefix = normalized.replace(/^(src|dist|tests?|__tests__)\//, '');
  const dir = path.posix.dirname(withoutPrefix);
  const base = path.posix.basename(withoutPrefix).replace(/\.(test|spec|stories|d)\./, '.');
  return `${dir}/${base}`;
}

/**
 * Whether two tasks declare an overlapping write footprint. Two tasks that
 * both leave `files:` empty never conflict here - that is not a claim they
 * are safe together, only that this function has no declared footprint to
 * compare. Safety for that case comes from worktree isolation and the merge
 * step, not from this check.
 */
export function tasksConflict(a: TaskNode, b: TaskNode): boolean {
  if (a.files.length === 0 || b.files.length === 0) return false;
  for (const fileA of a.files) {
    for (const fileB of b.files) {
      if (pathsOverlap(fileA, fileB)) return true;
      if (moduleKey(fileA) === moduleKey(fileB)) return true;
    }
  }
  return false;
}

/**
 * A greedy approximation of the largest conflict-free subset, tried from
 * every rotation of the input so the result does not depend on which task
 * happened to come first. Exact maximum independent set is not worth
 * computing here - the batches involved are small, and a slightly smaller
 * batch just means one more round trip, never an unsafe one.
 */
function selectNonConflictingBatch(candidates: TaskNode[]): TaskNode[] {
  let best: TaskNode[] = [];
  for (let start = 0; start < candidates.length; start++) {
    const ordered = [...candidates.slice(start), ...candidates.slice(0, start)];
    const selected: TaskNode[] = [];
    for (const task of ordered) {
      if (!selected.some((chosen) => tasksConflict(chosen, task))) selected.push(task);
    }
    if (selected.length > best.length) best = selected;
  }
  return candidates.filter((task) => best.includes(task));
}
