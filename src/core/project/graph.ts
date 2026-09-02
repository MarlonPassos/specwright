import { SpecError } from '../../util/errors.js';
import type { ProjectChange } from './model.js';

/**
 * The DAG between Project Changes. Independent of the schema's `ArtifactGraph`
 * (nodes, states and safety rules differ), but it adopts the same tie-break:
 * declaration order in the manifest, never alphabetical.
 */
export class ProjectGraph {
  private readonly ids: string[];
  private readonly index = new Map<string, number>();
  private readonly deps = new Map<string, string[]>();
  private readonly rdeps = new Map<string, string[]>();

  private constructor(changes: ProjectChange[]) {
    this.ids = changes.map((change) => change.id);
    changes.forEach((change, position) => {
      this.index.set(change.id, position);
      this.deps.set(change.id, [...change.depends_on]);
      this.rdeps.set(change.id, []);
    });
    for (const change of changes) {
      for (const dependency of change.depends_on) {
        this.rdeps.get(dependency)!.push(change.id);
      }
    }
  }

  /** Validates identity and acyclicity, then builds. Every failure is pre-write. */
  static from(changes: ProjectChange[]): ProjectGraph {
    const seenIds = new Set<string>();
    const seenSlugs = new Set<string>();
    for (const change of changes) {
      if (seenIds.has(change.id)) {
        throw new SpecError(`Dois registros com o id ${change.id}.`, { code: 'duplicate_change_id' });
      }
      seenIds.add(change.id);
      if (seenSlugs.has(change.slug)) {
        throw new SpecError(`Dois registros com o slug "${change.slug}".`, {
          code: 'duplicate_change_slug',
        });
      }
      seenSlugs.add(change.slug);
    }
    for (const change of changes) {
      for (const dependency of change.depends_on) {
        if (dependency === change.id) {
          throw new SpecError(`${change.id} depende de si mesmo.`, { code: 'self_dependency' });
        }
        if (!seenIds.has(dependency)) {
          throw new SpecError(`${change.id} depende de ${dependency}, que o plano não declara.`, {
            code: 'unknown_dependency',
          });
        }
      }
    }

    const graph = new ProjectGraph(changes);
    const cycle = graph.findCycle();
    if (cycle) {
      throw new SpecError(`Ciclo de dependência: ${cycle.join(' → ')}.`, { code: 'dependency_cycle' });
    }
    return graph;
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  dependencies(id: string): string[] {
    return [...(this.deps.get(id) ?? [])];
  }

  dependents(id: string): string[] {
    return [...(this.rdeps.get(id) ?? [])];
  }

  ancestors(id: string): string[] {
    return this.reach(id, (node) => this.deps.get(node) ?? []);
  }

  descendants(id: string): string[] {
    return this.reach(id, (node) => this.rdeps.get(node) ?? []);
  }

  roots(): string[] {
    return this.ids.filter((id) => (this.deps.get(id) ?? []).length === 0);
  }

  leaves(): string[] {
    return this.ids.filter((id) => (this.rdeps.get(id) ?? []).length === 0);
  }

  /** Topological order; ties broken by declaration index, so it is total. */
  order(): string[] {
    const indegree = new Map<string, number>();
    for (const id of this.ids) indegree.set(id, (this.deps.get(id) ?? []).length);

    const ready = this.ids.filter((id) => indegree.get(id) === 0);
    const result: string[] = [];
    const byDeclaration = (a: string, b: string) => this.index.get(a)! - this.index.get(b)!;

    ready.sort(byDeclaration);
    while (ready.length > 0) {
      const next = ready.shift()!;
      result.push(next);
      for (const dependent of this.rdeps.get(next) ?? []) {
        const remaining = indegree.get(dependent)! - 1;
        indegree.set(dependent, remaining);
        if (remaining === 0) {
          ready.push(dependent);
          ready.sort(byDeclaration);
        }
      }
    }
    return result;
  }

  private reach(start: string, edges: (node: string) => string[]): string[] {
    const seen = new Set<string>();
    const stack = [...edges(start)];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      stack.push(...edges(node));
    }
    return this.ids.filter((id) => seen.has(id));
  }

  private findCycle(): string[] | undefined {
    const WHITE = 0;
    const GREY = 1;
    const BLACK = 2;
    const color = new Map<string, number>(this.ids.map((id) => [id, WHITE]));
    const stack: string[] = [];

    const visit = (id: string): string[] | undefined => {
      color.set(id, GREY);
      stack.push(id);
      for (const dependency of this.deps.get(id) ?? []) {
        if (color.get(dependency) === GREY) {
          const from = stack.indexOf(dependency);
          return [...stack.slice(from), dependency];
        }
        if (color.get(dependency) === WHITE) {
          const found = visit(dependency);
          if (found) return found;
        }
      }
      stack.pop();
      color.set(id, BLACK);
      return undefined;
    };

    for (const id of this.ids) {
      if (color.get(id) === WHITE) {
        const found = visit(id);
        if (found) return found;
      }
    }
    return undefined;
  }
}
