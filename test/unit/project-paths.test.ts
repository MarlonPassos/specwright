import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resolveWithinRoot,
  plannedChangeFileName,
  plannedChangePath,
  resolvePlanId,
  listPlanIds,
  isKebabCase,
} from '../../src/core/project/paths.js';
import { makePlanWorkspace, seedPlan, manifest } from '../helpers/plan.js';

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'plan-paths-'));
}

describe('resolveWithinRoot', () => {
  it('accepts a plain relative path', async () => {
    const root = await tempRoot();
    expect(resolveWithinRoot(root, 'a/b.md')).toBe(path.join(root, 'a/b.md'));
  });

  it('rejects a parent-escape segment', async () => {
    const root = await tempRoot();
    expect(() => resolveWithinRoot(root, '../outside.md')).toThrow(/\.\./);
  });

  it('rejects an absolute path', async () => {
    const root = await tempRoot();
    expect(() => resolveWithinRoot(root, '/etc/passwd')).toThrow(/absoluto/);
  });

  it('rejects a NUL byte', async () => {
    const root = await tempRoot();
    expect(() => resolveWithinRoot(root, 'a\0b')).toThrow(/NUL/);
  });

  it('carries the requested error code', async () => {
    const root = await tempRoot();
    try {
      resolveWithinRoot(root, '../x', 'unsafe_source_path');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('unsafe_source_path');
    }
  });

  it('rejects a symlink that escapes the root', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await fs.writeFile(path.join(outside, 'secret.md'), 'x');
    await fs.symlink(outside, path.join(root, 'link'));
    expect(() => resolveWithinRoot(root, 'link/secret.md')).toThrow(/[Ss]ymlink|raiz/);
  });
});

describe('planned change file names', () => {
  it('derives <id>-<slug>.md', () => {
    expect(plannedChangeFileName('CH-002', 'authentication')).toBe('CH-002-authentication.md');
  });

  it('joins under planned-changes/', () => {
    expect(plannedChangePath('/plan', 'CH-002', 'auth')).toBe(
      path.join('/plan', 'planned-changes', 'CH-002-auth.md')
    );
  });
});

describe('plan resolution', () => {
  it('is kebab-case aware', () => {
    expect(isKebabCase('ecommerce')).toBe(true);
    expect(isKebabCase('E-Commerce')).toBe(false);
  });

  it('uses the only plan when none is named', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'only' }));
    expect(await resolvePlanId(workspace.projectRoot)).toBe('only');
  });

  it('fails with plan_not_found when there is none', async () => {
    const workspace = await makePlanWorkspace();
    await expect(resolvePlanId(workspace.projectRoot)).rejects.toMatchObject({ code: 'plan_not_found' });
  });

  it('fails with ambiguous_plan when there are several', async () => {
    const workspace = await makePlanWorkspace();
    await seedPlan(workspace, manifest({ id: 'alpha' }));
    await seedPlan(workspace, manifest({ id: 'beta' }));
    await expect(resolvePlanId(workspace.projectRoot)).rejects.toMatchObject({ code: 'ambiguous_plan' });
    expect(await listPlanIds(workspace.projectRoot)).toEqual(['alpha', 'beta']);
  });
});
