import { describe, expect, it } from 'vitest';
import { ProjectGraph } from '../../src/core/project/graph.js';
import { change } from '../helpers/plan.js';

const c = (id: string, deps: string[] = []) => change({ id, slug: id.toLowerCase(), depends_on: deps });

describe('ProjectGraph', () => {
  it('orders a linear chain', () => {
    const graph = ProjectGraph.from([c('CH-001'), c('CH-002', ['CH-001']), c('CH-003', ['CH-002'])]);
    expect(graph.order()).toEqual(['CH-001', 'CH-002', 'CH-003']);
  });

  it('breaks ties by declaration order, not alphabetically', () => {
    const graph = ProjectGraph.from([c('CH-003'), c('CH-001'), c('CH-002')]);
    expect(graph.order()).toEqual(['CH-003', 'CH-001', 'CH-002']);
  });

  it('resolves a diamond', () => {
    const graph = ProjectGraph.from([
      c('CH-001'),
      c('CH-002', ['CH-001']),
      c('CH-003', ['CH-001']),
      c('CH-004', ['CH-002', 'CH-003']),
    ]);
    expect(graph.order()[0]).toBe('CH-001');
    expect(graph.order()[3]).toBe('CH-004');
    expect(graph.ancestors('CH-004').sort()).toEqual(['CH-001', 'CH-002', 'CH-003']);
    expect(graph.descendants('CH-001').sort()).toEqual(['CH-002', 'CH-003', 'CH-004']);
    expect(graph.dependents('CH-001').sort()).toEqual(['CH-002', 'CH-003']);
  });

  it('rejects a cycle with the path in the message', () => {
    expect(() =>
      ProjectGraph.from([c('CH-001', ['CH-003']), c('CH-002', ['CH-001']), c('CH-003', ['CH-002'])])
    ).toThrowError(/Ciclo de dependência.*CH-00/);
  });

  it('rejects self-dependency and unknown dependency', () => {
    expect(() => ProjectGraph.from([c('CH-001', ['CH-001'])])).toThrowError(/depende de si mesmo/);
    expect(() => ProjectGraph.from([c('CH-001', ['CH-099'])])).toThrowError(/CH-099/);
  });

  it('rejects duplicate id and slug', () => {
    expect(() => ProjectGraph.from([c('CH-001'), c('CH-001')])).toThrowError(/duplicate|id CH-001/i);
    expect(() =>
      ProjectGraph.from([change({ id: 'CH-001', slug: 'x' }), change({ id: 'CH-002', slug: 'x' })])
    ).toThrowError(/slug/);
  });
});
