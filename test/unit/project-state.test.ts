import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  executionOf,
  materializationState,
  presentationOf,
  readinessOf,
  PLANNING_STATE_TRANSITIONS,
} from '../../src/core/project/state.js';
import { change } from '../helpers/plan.js';

const REF = {
  path: 'planned-changes/CH-001-x.md',
  generated_from_plan_revision: 1,
  source_hash: 'S',
  content_hash: 'C',
};

describe('materializationState', () => {
  it('missing without a ref or a file', () => {
    expect(
      materializationState({
        change: change({ id: 'CH-001', slug: 'x' }),
        briefContent: undefined,
        briefContentSha: undefined,
        currentSourceHash: 'S',
      })
    ).toBe('missing');
  });

  it('modified when the content hash drifts', () => {
    expect(
      materializationState({
        change: change({ id: 'CH-001', slug: 'x', planned_change: REF }),
        briefContent: '...',
        briefContentSha: 'OTHER',
        currentSourceHash: 'S',
      })
    ).toBe('modified');
  });

  it('outdated when the source hash drifts but content is intact', () => {
    expect(
      materializationState({
        change: change({ id: 'CH-001', slug: 'x', planned_change: REF }),
        briefContent: '...',
        briefContentSha: 'C',
        currentSourceHash: 'OTHER',
      })
    ).toBe('outdated');
  });

  it('current when both match', () => {
    expect(
      materializationState({
        change: change({ id: 'CH-001', slug: 'x', planned_change: REF }),
        briefContent: '...',
        briefContentSha: 'C',
        currentSourceHash: 'S',
      })
    ).toBe('current');
  });
});

describe('executionOf', () => {
  const link = { name: 'x', active_path: 'spec/changes/x', archive_path: null, linked_at: '2026-09-01' };
  const base = { linked: true, activeDirExists: true, proposalPresent: true, ambiguousArchive: [] };

  it('unlinked without a link', () => {
    expect(executionOf(null, { linked: false, activeDirExists: false, proposalPresent: false, ambiguousArchive: [] }).execution).toBe('unlinked');
  });

  it('archived when an archive path resolved', () => {
    expect(executionOf(link, { ...base, archivePath: 'spec/changes/archive/2026-09-01-x' }).execution).toBe('archived');
  });

  it('unknown when linked but nothing on disk', () => {
    expect(executionOf(link, { linked: true, activeDirExists: false, proposalPresent: false, ambiguousArchive: [] }).execution).toBe('unknown');
  });

  it('proposed, in_progress, verifying by task progress', () => {
    expect(executionOf(link, { ...base }).execution).toBe('proposed');
    expect(executionOf(link, { ...base, tasks: { total: 6, completed: 1 } }).execution).toBe('in_progress');
    expect(executionOf(link, { ...base, tasks: { total: 6, completed: 6 } }).execution).toBe('verifying');
  });
});

describe('readinessOf', () => {
  const deps = (map: Record<string, string>) => new Map(Object.entries(map)) as Map<string, any>;

  it('not_applicable for idea / on_hold / cancelled', () => {
    for (const planning_state of ['idea', 'on_hold', 'cancelled'] as const) {
      const result = readinessOf({
        change: change({ id: 'CH-001', slug: 'x', planning_state }),
        materialization: 'current',
        dependencyExecution: deps({}),
      });
      expect(result.readiness).toBe('not_applicable');
      expect(result.reasons).toContain('state_not_eligible');
    }
  });

  it('ready when planned, current, deps archived and no blocker', () => {
    const result = readinessOf({
      change: change({ id: 'CH-002', slug: 'x', depends_on: ['CH-001'] }),
      materialization: 'current',
      dependencyExecution: deps({ 'CH-001': 'archived' }),
    });
    expect(result.readiness).toBe('ready');
    expect(result.reasons).toEqual(['dependencies_satisfied', 'planned_change_current']);
  });

  it('manual blocker wins, blockedBy stays empty', () => {
    const result = readinessOf({
      change: change({ id: 'CH-003', slug: 'x', manual_blockers: ['imagens'], depends_on: ['CH-001'] }),
      materialization: 'current',
      dependencyExecution: deps({ 'CH-001': 'archived' }),
    });
    expect(result.readiness).toBe('blocked');
    expect(result.reasons).toContain('manual_blocker_present');
    expect(result.blockedBy).toEqual([]);
  });

  it('a manual blocker outranks a pending dependency (§7.7)', () => {
    const result = readinessOf({
      change: change({ id: 'CH-003', slug: 'x', manual_blockers: ['imagens'], depends_on: ['CH-001'] }),
      materialization: 'current',
      dependencyExecution: deps({ 'CH-001': 'proposed' }),
    });
    expect(result.reasons).toEqual(['manual_blocker_present']);
    expect(result.blockedBy).toEqual([]);
  });

  it('dependency pending is reported with blockedBy', () => {
    const result = readinessOf({
      change: change({ id: 'CH-002', slug: 'x', depends_on: ['CH-001'] }),
      materialization: 'current',
      dependencyExecution: deps({ 'CH-001': 'proposed' }),
    });
    expect(result.reasons).toContain('dependency_pending');
    expect(result.blockedBy).toEqual(['CH-001']);
  });

  it('a non-current brief blocks', () => {
    const result = readinessOf({
      change: change({ id: 'CH-001', slug: 'x' }),
      materialization: 'outdated',
      dependencyExecution: deps({}),
    });
    expect(result.reasons).toContain('planned_change_outdated');
  });
});

describe('presentation and transitions', () => {
  it('archived is always concluída', () => {
    expect(
      presentationOf({ planningState: 'planned', readiness: 'ready', execution: 'archived' })
    ).toBe('concluída');
  });

  it('unknown execution is inconsistente', () => {
    expect(
      presentationOf({ planningState: 'planned', readiness: 'blocked', execution: 'unknown' })
    ).toBe('inconsistente');
  });

  it('the state machine matches §7.6', () => {
    expect(PLANNING_STATE_TRANSITIONS.cancelled).toEqual([]);
    expect(() => assertTransition('cancelled', 'planned')).toThrowError(/invalid_transition|Não há transição/);
    expect(() => assertTransition('idea', 'planned')).not.toThrow();
    expect(() => assertTransition('planned', 'idea')).toThrow();
  });
});
