import { describe, expect, it } from 'vitest';
import {
  TaskGraph,
  findDependencyCycle,
  findUnknownDependencies,
  tasksConflict,
} from '../../src/core/change/taskGraph.js';
import type { Task } from '../../src/core/change/model.js';

function task(overrides: Partial<Task>): Task {
  return {
    number: '',
    text: 'do it',
    done: false,
    line: 1,
    files: [],
    dependsOn: [],
    ...overrides,
  };
}

describe('tasksConflict', () => {
  it('never conflicts when either side declares no files', () => {
    expect(tasksConflict(task({ number: '1' }), task({ number: '2', files: ['a.ts'] }))).toBe(false);
  });

  it('conflicts on an exact path match', () => {
    expect(
      tasksConflict(task({ number: '1', files: ['src/a.ts'] }), task({ number: '2', files: ['src/a.ts'] }))
    ).toBe(true);
  });

  it('conflicts when one path is a subdirectory of the other', () => {
    expect(
      tasksConflict(task({ number: '1', files: ['src/export'] }), task({ number: '2', files: ['src/export/csv.ts'] }))
    ).toBe(true);
  });

  it('conflicts when two files fold to the same module key', () => {
    expect(
      tasksConflict(task({ number: '1', files: ['src/foo.ts'] }), task({ number: '2', files: ['test/foo.test.ts'] }))
    ).toBe(true);
  });

  it('does not conflict on unrelated files', () => {
    expect(
      tasksConflict(task({ number: '1', files: ['src/a.ts'] }), task({ number: '2', files: ['src/b.ts'] }))
    ).toBe(false);
  });
});

describe('findUnknownDependencies / findDependencyCycle', () => {
  it('reports every unknown dependency, not just the first', () => {
    const tasks = [task({ number: '1', dependsOn: ['9'] }), task({ number: '2', dependsOn: ['8', '9'] })];
    const unknown = findUnknownDependencies(tasks);
    expect(unknown).toHaveLength(3);
  });

  it('finds a two-task cycle', () => {
    const tasks = [task({ number: '1', dependsOn: ['2'] }), task({ number: '2', dependsOn: ['1'] })];
    expect(findDependencyCycle(tasks)).toEqual(['1', '2', '1']);
  });

  it('reports no cycle for a plain chain', () => {
    const tasks = [task({ number: '1' }), task({ number: '2', dependsOn: ['1'] })];
    expect(findDependencyCycle(tasks)).toBeUndefined();
  });
});

describe('TaskGraph.from', () => {
  it('rejects a duplicated task number even though specs validate only warns about it', () => {
    const tasks = [task({ number: '1' }), task({ number: '1' })];
    expect(() => TaskGraph.from(tasks)).toThrow(/Número de tarefa duplicado/);
  });

  it('rejects an unknown dependency', () => {
    expect(() => TaskGraph.from([task({ number: '1', dependsOn: ['9'] })])).toThrow(/task_depends_unknown|9/);
  });

  it('rejects a dependency cycle', () => {
    const tasks = [task({ number: '1', dependsOn: ['2'] }), task({ number: '2', dependsOn: ['1'] })];
    expect(() => TaskGraph.from(tasks)).toThrow(/Ciclo de dependência/);
  });

  it('leaves an unnumbered task out of the graph entirely', () => {
    const graph = TaskGraph.from([task({ number: '' }), task({ number: '1' })]);
    expect(graph.all.map((t) => t.number)).toEqual(['1']);
  });
});

describe('TaskGraph.ready / nextBatch', () => {
  it('only surfaces pending tasks whose dependencies are all done', () => {
    const graph = TaskGraph.from([
      task({ number: '1', done: true }),
      task({ number: '2', dependsOn: ['1'] }),
      task({ number: '3', dependsOn: ['2'] }),
    ]);
    expect(graph.ready().map((t) => t.number)).toEqual(['2']);
  });

  it('batches disjoint tasks together and defers a conflicting one', () => {
    const graph = TaskGraph.from([
      task({ number: '1', files: ['a.ts'] }),
      task({ number: '2', files: ['a.ts'] }),
      task({ number: '3', files: ['b.ts'] }),
    ]);
    const { batch, deferred } = graph.nextBatch();
    expect(batch.map((t) => t.number).sort()).toEqual(['1', '3']);
    expect(deferred.map((entry) => entry.task.number)).toEqual(['2']);
  });

  it('includes tasks with no declared files in the same batch (safety moved to the merge step)', () => {
    const graph = TaskGraph.from([task({ number: '1' }), task({ number: '2' })]);
    expect(graph.nextBatch().batch.map((t) => t.number).sort()).toEqual(['1', '2']);
  });

  it('caps a batch at the given limit', () => {
    const graph = TaskGraph.from([
      task({ number: '1', files: ['a.ts'] }),
      task({ number: '2', files: ['b.ts'] }),
      task({ number: '3', files: ['c.ts'] }),
    ]);
    expect(graph.nextBatch(2).batch).toHaveLength(2);
  });

  it('returns an empty batch when nothing is ready', () => {
    const graph = TaskGraph.from([task({ number: '1', done: true })]);
    expect(graph.nextBatch()).toEqual({ batch: [], deferred: [] });
  });
});
