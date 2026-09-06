import { describe, expect, it } from 'vitest';
import { computeCompletion, type CompletionInput } from '../../src/core/project/loop.js';

/** A graph as `{ id: [dependências diretas] }`; ancestrais são derivados. */
function scenario(
  graph: Record<string, string[]>,
  blocked: Record<string, { reasonCodes: string[]; manualBlockers?: string[] }> = {},
  options: { cancelled?: string[]; planBlocked?: boolean; remaining?: string[] } = {}
): CompletionInput {
  const ancestors = (id: string): string[] => {
    const out = new Set<string>();
    const walk = (current: string): void => {
      for (const dep of graph[current] ?? []) {
        if (out.has(dep)) continue;
        out.add(dep);
        walk(dep);
      }
    };
    walk(id);
    return [...out];
  };
  return {
    remaining: options.remaining ?? Object.keys(graph),
    blockedReasons: new Map(
      Object.entries(blocked).map(([id, value]) => [
        id,
        { reasonCodes: value.reasonCodes, manualBlockers: value.manualBlockers ?? [] },
      ])
    ),
    cancelledIds: new Set(options.cancelled ?? []),
    planBlocked: options.planBlocked === true,
    dependsOnOf: (id) => graph[id] ?? [],
    ancestorsOf: ancestors,
  };
}

describe('computeCompletion', () => {
  it('uma corrente inteira só à espera de dependência é alcançável', () => {
    // O estado normal de um plano no minuto zero: quase tudo bloqueado, e isso
    // é o loop funcionando. Avisar aqui seria alarme falso em todo plano.
    const result = computeCompletion(
      scenario(
        { 'CH-001': [], 'CH-002': ['CH-001'], 'CH-003': ['CH-002'] },
        { 'CH-002': { reasonCodes: ['dependency_pending'] }, 'CH-003': { reasonCodes: ['dependency_pending'] } }
      )
    );

    expect(result.willComplete).toBe(true);
    expect(result.unreachable).toEqual([]);
    expect(result.terminal).toEqual([]);
  });

  it('um bloqueio manual é terminal e leva os descendentes junto', () => {
    const result = computeCompletion(
      scenario(
        { 'CH-001': [], 'CH-002': ['CH-001'], 'CH-003': ['CH-002'], 'CH-004': [] },
        {
          'CH-001': { reasonCodes: ['manual_blocker_present'], manualBlockers: ['Aguardando jurídico'] },
          'CH-002': { reasonCodes: ['dependency_pending'] },
          'CH-003': { reasonCodes: ['dependency_pending'] },
        }
      )
    );

    expect(result.willComplete).toBe(false);
    expect(result.reachable).toEqual(['CH-004']);
    expect(result.unreachable).toEqual(['CH-001', 'CH-002', 'CH-003']);
    expect(result.terminal).toEqual([
      {
        id: 'CH-001',
        reasonCodes: ['manual_blocker_present'],
        manualBlockers: ['Aguardando jurídico'],
        blocks: ['CH-002', 'CH-003'],
      },
    ]);
  });

  it('só a raiz vira terminal; quem cai por tabela não vira causa', () => {
    const result = computeCompletion(
      scenario(
        { 'CH-001': [], 'CH-002': ['CH-001'] },
        {
          'CH-001': { reasonCodes: ['planned_change_invalid'] },
          'CH-002': { reasonCodes: ['dependency_pending'] },
        }
      )
    );

    expect(result.terminal.map((entry) => entry.id)).toEqual(['CH-001']);
    expect(result.unreachable).toEqual(['CH-001', 'CH-002']);
  });

  it('depender de um incremento cancelado é terminal, apesar da razão comum', () => {
    // O cancelado nunca chega a `archived`, então `dependency_pending` fica para
    // sempre. Ler só a razão chamaria isto de alcançável.
    const result = computeCompletion(
      scenario(
        { 'CH-002': ['CH-001'] },
        { 'CH-002': { reasonCodes: ['dependency_pending'] } },
        { cancelled: ['CH-001'], remaining: ['CH-002'] }
      )
    );

    expect(result.willComplete).toBe(false);
    expect(result.terminal).toEqual([
      { id: 'CH-002', reasonCodes: ['dependency_cancelled'], manualBlockers: [], blocks: [] },
    ]);
  });

  it('uma razão mista não é transitória — dependência é só parte do problema', () => {
    const result = computeCompletion(
      scenario(
        { 'CH-001': [] },
        { 'CH-001': { reasonCodes: ['planned_change_outdated', 'dependency_pending'] } }
      )
    );

    expect(result.terminal.map((entry) => entry.id)).toEqual(['CH-001']);
  });

  it('um bloqueio de plano deixa tudo inalcançável', () => {
    const result = computeCompletion(
      scenario({ 'CH-001': [], 'CH-002': [] }, {}, { planBlocked: true })
    );

    expect(result.willComplete).toBe(false);
    expect(result.reachable).toEqual([]);
    expect(result.unreachable).toEqual(['CH-001', 'CH-002']);
  });

  it('um plano sem pendências completa', () => {
    const result = computeCompletion(scenario({}, {}, { remaining: [] }));
    expect(result.willComplete).toBe(true);
  });
});
