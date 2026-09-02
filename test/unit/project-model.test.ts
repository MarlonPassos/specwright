import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  PlanManifestSchema,
  ProjectChangeSchema,
  CHANGE_ID_PATTERN,
  renderManifest,
  formatZodIssues,
} from '../../src/core/project/model.js';
import { parseManifest } from '../../src/core/project/repository.js';
import { manifest, change, planSimple } from '../helpers/plan.js';

describe('project model — schema', () => {
  it('accepts a minimal manifest and applies defaults', () => {
    const parsed = PlanManifestSchema.parse({
      schema_version: 1,
      revision: 0,
      id: 'demo',
      name: 'Demo',
      status: 'draft',
      created_at: '2026-09-01',
      updated_at: '2026-09-01',
    });
    expect(parsed.source_documents).toEqual([]);
    expect(parsed.milestones).toEqual([]);
    expect(parsed.changes).toEqual([]);
  });

  it('defaults an omitted priority to medium', () => {
    const parsed = ProjectChangeSchema.parse({
      id: 'CH-001',
      slug: 'foundation',
      title: 'Fundação',
      planning_state: 'planned',
      milestone: null,
      planned_change: null,
      link: null,
    });
    expect(parsed.priority).toBe('medium');
  });

  it('reports the field path on an invalid change id', () => {
    const result = ProjectChangeSchema.safeParse({
      id: 'foundation',
      slug: 'foundation',
      title: 'x',
      planning_state: 'planned',
      milestone: null,
      planned_change: null,
      link: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodIssues(result.error)[0].path).toBe('id');
    }
  });

  it('rejects a bad date stamp', () => {
    const result = PlanManifestSchema.safeParse({
      schema_version: 1,
      revision: 0,
      id: 'demo',
      name: 'Demo',
      status: 'draft',
      created_at: '01-09-2026',
      updated_at: '2026-09-01',
    });
    expect(result.success).toBe(false);
  });

  it('CHANGE_ID_PATTERN needs at least three digits', () => {
    expect(CHANGE_ID_PATTERN.test('CH-001')).toBe(true);
    expect(CHANGE_ID_PATTERN.test('CH-1')).toBe(false);
    expect(CHANGE_ID_PATTERN.test('CH-0001')).toBe(true);
  });
});

describe('project model — deterministic serialization', () => {
  it('round-trips load → save → load byte-identically', () => {
    const first = renderManifest(planSimple());
    const reparsed = PlanManifestSchema.parse(parseYaml(first));
    const second = renderManifest(reparsed);
    expect(second).toBe(first);
  });

  it('emits keys in the fixed contract order', () => {
    const yaml = renderManifest(
      manifest({
        owner: 'team',
        changes: [change({ id: 'CH-001', slug: 'a', depends_on: [] })],
      })
    );
    const keys = yaml
      .split('\n')
      .filter((line) => /^[a-z_]+:/.test(line))
      .map((line) => line.slice(0, line.indexOf(':')));
    expect(keys.slice(0, 5)).toEqual(['schema_version', 'revision', 'id', 'name', 'status']);
  });

  it('always writes the nullable objects explicitly', () => {
    const yaml = renderManifest(manifest({ changes: [change({ id: 'CH-001', slug: 'a' })] }));
    expect(yaml).toContain('planned_change: null');
    expect(yaml).toContain('link: null');
    expect(yaml).toContain('milestone: null');
  });

  it('milestones serialize sorted by order', () => {
    const yaml = renderManifest(
      manifest({
        milestones: [
          { id: 'M2', name: 'Dois', order: 2, changes: [] },
          { id: 'M1', name: 'Um', order: 1, changes: [] },
        ],
      })
    );
    expect(yaml.indexOf('id: M1')).toBeLessThan(yaml.indexOf('id: M2'));
  });
});

describe('project model — parseManifest', () => {
  it('flags a missing schema_version as fatal', () => {
    const result = parseManifest('id: demo\nname: Demo\n');
    expect(result.fatal).toBe(true);
    expect(result.code).toBe('invalid_plan');
  });

  it('flags an unsupported schema_version with its own code and fix', () => {
    const result = parseManifest('schema_version: 2\nid: demo\n');
    expect(result.code).toBe('unsupported_plan_version');
    expect(result.fix).toContain('specwright');
  });

  it('rejects invalid YAML', () => {
    const result = parseManifest(':\n  - [');
    expect(result.fatal).toBe(true);
    expect(result.code).toBe('invalid_plan');
  });
});
