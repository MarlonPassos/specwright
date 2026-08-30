import { SpecError } from '../../util/errors.js';
import type { ArtifactDefinition, CompletedArtifacts, WorkflowSchemaFile } from './types.js';

/**
 * The artifact dependency graph of one workflow schema.
 *
 * Ties are broken by declaration order rather than alphabetically: siblings
 * that share the same dependencies (spec-driven's `specs` and `design` both
 * depend only on `proposal`) then come out in the order the schema author
 * wrote them, which is the order the schema documents.
 */
export class ArtifactGraph {
  private readonly byId: Map<string, ArtifactDefinition>;
  private readonly declarationIndex: Map<string, number>;

  private constructor(private readonly file: WorkflowSchemaFile) {
    this.byId = new Map(file.artifacts.map((artifact) => [artifact.id, artifact]));
    this.declarationIndex = new Map(file.artifacts.map((artifact, index) => [artifact.id, index]));
  }

  static from(file: WorkflowSchemaFile): ArtifactGraph {
    assertUniqueIds(file.artifacts);
    assertKnownDependencies(file);
    assertAcyclic(file.artifacts);
    return new ArtifactGraph(file);
  }

  get name(): string {
    return this.file.name;
  }

  get version(): number {
    return this.file.version;
  }

  get description(): string | undefined {
    return this.file.description;
  }

  get apply() {
    return this.file.apply;
  }

  get artifacts(): ArtifactDefinition[] {
    return [...this.file.artifacts];
  }

  get(id: string): ArtifactDefinition | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  private compare = (a: string, b: string): number =>
    (this.declarationIndex.get(a) ?? Number.MAX_SAFE_INTEGER) -
    (this.declarationIndex.get(b) ?? Number.MAX_SAFE_INTEGER);

  /** Every artifact id in an order where dependencies always come first. */
  buildOrder(): string[] {
    const pending = new Map(this.file.artifacts.map((a) => [a.id, a.requires.length]));
    const dependents = new Map<string, string[]>(this.file.artifacts.map((a) => [a.id, []]));
    for (const artifact of this.file.artifacts) {
      for (const dependency of artifact.requires) {
        dependents.get(dependency)!.push(artifact.id);
      }
    }

    const queue = [...pending.entries()]
      .filter(([, count]) => count === 0)
      .map(([id]) => id)
      .sort(this.compare);
    const ordered: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      ordered.push(current);
      for (const dependent of dependents.get(current)!) {
        const remaining = pending.get(dependent)! - 1;
        pending.set(dependent, remaining);
        if (remaining === 0) queue.push(dependent);
      }
      // Re-sorting the whole queue, not only the arrivals: an artifact that has
      // been waiting can be declared after one that just became ready.
      queue.sort(this.compare);
    }

    return ordered;
  }

  /** Incomplete artifacts whose dependencies are all complete. */
  ready(completed: CompletedArtifacts): string[] {
    return this.file.artifacts
      .filter((a) => !completed.has(a.id) && a.requires.every((dep) => completed.has(dep)))
      .map((a) => a.id)
      .sort(this.compare);
  }

  /** Incomplete artifacts mapped to the dependencies still missing. */
  blocked(completed: CompletedArtifacts): Record<string, string[]> {
    const blocked: Record<string, string[]> = {};
    for (const artifact of this.file.artifacts) {
      if (completed.has(artifact.id)) continue;
      const missing = artifact.requires.filter((dep) => !completed.has(dep)).sort(this.compare);
      if (missing.length > 0) blocked[artifact.id] = missing;
    }
    return blocked;
  }

  /**
   * The apply phase's requirements plus everything they depend on,
   * transitively. This is the set that must exist before implementation
   * starts - `apply.requires` alone under-reports it.
   */
  requiredForApply(): string[] {
    const seeds = this.file.apply?.requires ?? [];
    const seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const dependency of this.get(id)?.requires ?? []) visit(dependency);
    };
    for (const seed of seeds) visit(seed);
    return [...seen].sort(this.compare);
  }
}

function assertUniqueIds(artifacts: ArtifactDefinition[]): void {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    if (seen.has(artifact.id)) {
      throw new SpecError(`O schema declara o artefato "${artifact.id}" duas vezes`, {
        code: 'invalid_schema',
      });
    }
    seen.add(artifact.id);
  }
}

function assertKnownDependencies(file: WorkflowSchemaFile): void {
  const ids = new Set(file.artifacts.map((artifact) => artifact.id));
  for (const artifact of file.artifacts) {
    for (const dependency of artifact.requires) {
      if (!ids.has(dependency)) {
        throw new SpecError(
          `O artefato "${artifact.id}" requer "${dependency}", que o schema não declara`,
          { code: 'invalid_schema' }
        );
      }
    }
  }
  for (const required of file.apply?.requires ?? []) {
    if (!ids.has(required)) {
      throw new SpecError(
        `apply.requires nomeia "${required}", que o schema não declara`,
        { code: 'invalid_schema' }
      );
    }
  }
}

function assertAcyclic(artifacts: ArtifactDefinition[]): void {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  const visit = (id: string): void => {
    if (onStack.has(id)) {
      const cycle = [...stack.slice(stack.indexOf(id)), id].join(' -> ');
      throw new SpecError(`O schema tem um ciclo de dependências: ${cycle}`, { code: 'invalid_schema' });
    }
    if (visited.has(id)) return;

    visited.add(id);
    onStack.add(id);
    stack.push(id);
    for (const dependency of byId.get(id)?.requires ?? []) visit(dependency);
    stack.pop();
    onStack.delete(id);
  };

  for (const artifact of artifacts) visit(artifact.id);
}
