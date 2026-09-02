import { describe, expect, it } from 'vitest';
import { applyBundle, parseBundle, BUNDLE_VERSION } from '../../src/core/project/bundle.js';
import { manifest, change } from '../helpers/plan.js';

const ctx = {
  archivedIds: new Set<string>(),
  allowCompleted: false,
  resolveSourceHash: () => undefined,
  now: new Date('2026-09-01T12:00:00'),
};

function bundle(operations: unknown[], expectRevision = 0) {
  return { bundleVersion: BUNDLE_VERSION, expectRevision, operations };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`esperava lançar com code "${code}"`);
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

describe('parseBundle', () => {
  it('rejects an unknown version', () => {
    expect(() => parseBundle({ bundleVersion: 9, expectRevision: 0, operations: [] })).toThrowError(
      /unsupported_bundle_version|não é suportado/
    );
  });

  it('rejects a malformed bundle', () => {
    expect(() => parseBundle({ operations: 'nope' })).toThrowError(/invalid_bundle|inválido/);
  });

  it('rejects an unknown operation', () => {
    expect(() => parseBundle(bundle([{ op: 'teleport', id: 'CH-001' }]))).toThrowError(/inválido/);
  });
});

describe('applyBundle', () => {
  it('checks expectRevision', () => {
    expectCode(() => applyBundle(manifest({ revision: 7 }), parseBundle(bundle([], 6)), ctx), 'plan_revision_conflict');
  });

  it('allocates ids for refs and returns a reproducible idMap', () => {
    const b = parseBundle(
      bundle([
        { op: 'addChange', ref: '$a', slug: 'foundation', title: 'F' },
        { op: 'addChange', ref: '$b', slug: 'auth', title: 'A', dependsOn: ['$a'] },
      ])
    );
    const first = applyBundle(manifest({}), b, ctx);
    const second = applyBundle(manifest({}), b, ctx);
    expect(first.idMap).toEqual({ $a: 'CH-001', $b: 'CH-002' });
    expect(second.idMap).toEqual(first.idMap);
    expect(first.manifest.changes[1].depends_on).toEqual(['CH-001']);
    expect(first.manifest.revision).toBe(1);
  });

  it('rejects an unknown ref and an unknown dependency', () => {
    expectCode(
      () =>
        applyBundle(
          manifest({}),
          parseBundle(bundle([{ op: 'addChange', slug: 'x', title: 'X', dependsOn: ['$ghost'] }])),
          ctx
        ),
      'unknown_ref'
    );
    expectCode(
      () =>
        applyBundle(
          manifest({ changes: [change({ id: 'CH-001', slug: 'a' })] }),
          parseBundle(bundle([{ op: 'setDependencies', id: 'CH-001', dependsOn: ['CH-099'] }], 0)),
          ctx
        ),
      'unknown_dependency'
    );
  });

  it('protects a completed increment unless --allow-completed', () => {
    const base = manifest({ changes: [change({ id: 'CH-001', slug: 'a' })] });
    const b = parseBundle(bundle([{ op: 'updateChange', id: 'CH-001', set: { title: 'New' } }], 0));
    expectCode(
      () => applyBundle(base, b, { ...ctx, archivedIds: new Set(['CH-001']) }),
      'completed_change_protected'
    );
    const ok = applyBundle(base, b, {
      ...ctx,
      archivedIds: new Set(['CH-001']),
      allowCompleted: true,
    });
    expect(ok.completedTouched).toEqual(['CH-001']);
  });

  it('split cancels the original with superseded_by and rewires every dependent', () => {
    const base = manifest({
      changes: [
        change({ id: 'CH-008', slug: 'checkout' }),
        change({ id: 'CH-009', slug: 'x', depends_on: ['CH-008'] }),
        change({ id: 'CH-010', slug: 'y', depends_on: ['CH-008'] }),
      ],
    });
    const b = parseBundle(
      bundle(
        [
          {
            op: 'splitChange',
            id: 'CH-008',
            into: [
              { ref: '$s1', slug: 'cart', title: 'Carrinho' },
              { ref: '$s2', slug: 'pay', title: 'Pagamento' },
            ],
            rewire: { 'CH-009': ['$s1'], 'CH-010': ['$s1', '$s2'] },
          },
        ],
        0
      )
    );
    const result = applyBundle(base, b, ctx);
    const original = result.manifest.changes.find((c) => c.id === 'CH-008')!;
    expect(original.planning_state).toBe('cancelled');
    expect(original.superseded_by).toEqual(['CH-011', 'CH-012']);
    expect(result.manifest.changes.find((c) => c.id === 'CH-009')!.depends_on).toEqual(['CH-011']);
    expect(result.manifest.changes.find((c) => c.id === 'CH-010')!.depends_on).toEqual(['CH-011', 'CH-012']);
  });

  it('split fails when a dependent is not mapped in rewire', () => {
    const base = manifest({
      changes: [
        change({ id: 'CH-008', slug: 'a' }),
        change({ id: 'CH-009', slug: 'x', depends_on: ['CH-008'] }),
        change({ id: 'CH-010', slug: 'y', depends_on: ['CH-008'] }),
      ],
    });
    expect(() =>
      applyBundle(
        base,
        parseBundle(
          bundle(
            [
              {
                op: 'splitChange',
                id: 'CH-008',
                into: [
                  { ref: '$s1', slug: 'cart', title: 'C' },
                  { ref: '$s2', slug: 'pay', title: 'P' },
                ],
                rewire: { 'CH-009': ['$s1'] },
              },
            ],
            0
          )
        ),
        ctx
      )
    ).toThrowError(/unmapped_dependents|CH-010/);
  });

  it('merge keeps a survivor and refuses a completed entry', () => {
    const base = manifest({
      changes: [
        change({ id: 'CH-011', slug: 'a' }),
        change({ id: 'CH-012', slug: 'b', depends_on: ['CH-011'] }),
      ],
    });
    const merge = parseBundle(
      bundle([{ op: 'mergeChanges', ids: ['CH-011', 'CH-012'], survivor: 'CH-011' }], 0)
    );
    const result = applyBundle(base, merge, ctx);
    expect(result.manifest.changes.find((c) => c.id === 'CH-012')!.planning_state).toBe('cancelled');
    expect(result.manifest.changes.find((c) => c.id === 'CH-012')!.superseded_by).toEqual(['CH-011']);

    expectCode(
      () => applyBundle(base, merge, { ...ctx, archivedIds: new Set(['CH-012']) }),
      'merge_completed_change'
    );
  });

  it('renameSlug preserves the id and records the brief rename', () => {
    const base = manifest({
      changes: [
        change({
          id: 'CH-003',
          slug: 'old',
          planned_change: {
            path: 'planned-changes/CH-003-old.md',
            generated_from_plan_revision: 1,
            source_hash: 's',
            content_hash: 'c',
          },
        }),
      ],
    });
    const result = applyBundle(
      base,
      parseBundle(bundle([{ op: 'renameSlug', id: 'CH-003', slug: 'catalog' }], 0)),
      ctx
    );
    expect(result.manifest.changes[0].slug).toBe('catalog');
    expect(result.manifest.changes[0].planned_change!.path).toBe('planned-changes/CH-003-catalog.md');
    expect(result.briefRenames).toEqual([
      { from: 'planned-changes/CH-003-old.md', to: 'planned-changes/CH-003-catalog.md' },
    ]);
  });

  it('a cycle in the proposed state fails before any write', () => {
    const base = manifest({
      changes: [change({ id: 'CH-001', slug: 'a' }), change({ id: 'CH-002', slug: 'b' })],
    });
    expectCode(
      () =>
        applyBundle(
          base,
          parseBundle(
            bundle(
              [
                { op: 'setDependencies', id: 'CH-001', dependsOn: ['CH-002'] },
                { op: 'setDependencies', id: 'CH-002', dependsOn: ['CH-001'] },
              ],
              0
            )
          ),
          ctx
        ),
      'dependency_cycle'
    );
  });
});
