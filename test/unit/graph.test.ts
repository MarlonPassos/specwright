import { describe, expect, it } from 'vitest';
import { ArtifactGraph } from '../../src/core/schema/graph.js';
import { WorkflowSchemaFileSchema } from '../../src/core/schema/types.js';

function schema(artifacts: Array<Record<string, unknown>>, apply?: Record<string, unknown>) {
  return WorkflowSchemaFileSchema.parse({
    name: 'test',
    version: 1,
    artifacts,
    ...(apply ? { apply } : {}),
  });
}

const SPEC_DRIVEN = schema(
  [
    { id: 'proposal', generates: 'proposal.md', template: 'proposal.md', requires: [] },
    { id: 'specs', generates: 'specs/**/*.md', template: 'spec.md', requires: ['proposal'] },
    { id: 'design', generates: 'design.md', template: 'design.md', requires: ['proposal'] },
    { id: 'tasks', generates: 'tasks.md', template: 'tasks.md', requires: ['specs', 'design'] },
  ],
  { requires: ['tasks'], tracks: 'tasks.md' }
);

describe('ArtifactGraph', () => {
  it('orders artifacts so dependencies come first, breaking ties by declaration order', () => {
    expect(ArtifactGraph.from(SPEC_DRIVEN).buildOrder()).toEqual([
      'proposal',
      'specs',
      'design',
      'tasks',
    ]);
  });

  it('reports the artifacts whose dependencies are satisfied', () => {
    const graph = ArtifactGraph.from(SPEC_DRIVEN);
    expect(graph.ready(new Set())).toEqual(['proposal']);
    expect(graph.ready(new Set(['proposal']))).toEqual(['specs', 'design']);
    expect(graph.ready(new Set(['proposal', 'specs', 'design']))).toEqual(['tasks']);
    expect(graph.ready(new Set(['proposal', 'specs', 'design', 'tasks']))).toEqual([]);
  });

  it('reports what each blocked artifact is waiting on', () => {
    const graph = ArtifactGraph.from(SPEC_DRIVEN);
    expect(graph.blocked(new Set(['proposal']))).toEqual({ tasks: ['specs', 'design'] });
  });

  it('closes the apply requirements over their dependencies', () => {
    expect(ArtifactGraph.from(SPEC_DRIVEN).requiredForApply()).toEqual([
      'proposal',
      'specs',
      'design',
      'tasks',
    ]);
  });

  it('rejects a dependency the schema never declares', () => {
    expect(() =>
      ArtifactGraph.from(
        schema([{ id: 'a', generates: 'a.md', template: 'a.md', requires: ['ghost'] }])
      )
    ).toThrow(/requires "ghost"/);
  });

  it('rejects a duplicated artifact id', () => {
    expect(() =>
      ArtifactGraph.from(
        schema([
          { id: 'a', generates: 'a.md', template: 'a.md' },
          { id: 'a', generates: 'b.md', template: 'b.md' },
        ])
      )
    ).toThrow(/twice/);
  });

  it('rejects a dependency cycle and names it', () => {
    expect(() =>
      ArtifactGraph.from(
        schema([
          { id: 'a', generates: 'a.md', template: 'a.md', requires: ['b'] },
          { id: 'b', generates: 'b.md', template: 'b.md', requires: ['a'] },
        ])
      )
    ).toThrow(/cycle: a -> b -> a/);
  });

  it('rejects an apply phase that requires an unknown artifact', () => {
    expect(() =>
      ArtifactGraph.from(
        schema([{ id: 'a', generates: 'a.md', template: 'a.md' }], { requires: ['ghost'] })
      )
    ).toThrow(/apply.requires names "ghost"/);
  });
});

describe('schema validation', () => {
  it('rejects a template path that escapes its directory', () => {
    expect(() =>
      schema([{ id: 'a', generates: 'a.md', template: '../outside.md' }])
    ).toThrow();
  });

  it('rejects an absolute output path', () => {
    expect(() => schema([{ id: 'a', generates: '/tmp/a.md', template: 'a.md' }])).toThrow();
  });
});
