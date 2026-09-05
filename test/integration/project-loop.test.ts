import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { change, manifest, makePlanWorkspace, seedPlan, withBrief } from '../helpers/plan.js';
import { parseJson, runCli, seedChange, writeFile } from '../helpers/workspace.js';

describe('specs project loop CLI', () => {
  it('prints the complete read-only frontier and uses the selected plan', async () => {
    const workspace = await makePlanWorkspace();
    const entry = await withBrief(workspace, 'demo', change({ id: 'CH-001', slug: 'foundation' }));
    await seedPlan(workspace, manifest({ changes: [entry] }));
    await seedPlan(workspace, manifest({ id: 'other' }));
    const manifestFile = path.join(workspace.projectRoot, 'planning/demo/plan.yaml');
    const before = await fs.readFile(manifestFile, 'utf8');
    const result = await runCli(['project', 'loop', 'demo', '--json'], workspace.projectRoot);
    expect(result.code).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      loopSchemaVersion: 1, plan: { id: 'demo' }, state: 'ready',
      candidates: [{ id: 'CH-001', change: 'foundation', action: 'propose' }],
    });
    expect(await fs.readFile(manifestFile, 'utf8')).toBe(before);
    await expect(fs.stat(path.join(workspace.changesPath, 'foundation'))).rejects.toThrow();

    const text = await runCli(['project', 'loop', 'demo'], workspace.projectRoot);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('CH-001 foundation: propose');
    expect(text.stdout).toContain('Consulta somente leitura');

    const ambiguous = await runCli(['project', 'loop', '--json'], workspace.projectRoot);
    expect(ambiguous.code).toBe(1);
    expect(parseJson(ambiguous.stdout).error.code).toBeTruthy();
  });

  it('recomputes phases and completion through actual CLI lifecycle mutations', async () => {
    const workspace = await makePlanWorkspace();
    const entries = await Promise.all([
      change({ id: 'CH-001', slug: 'foundation' }),
      change({ id: 'CH-002', slug: 'feature', depends_on: ['CH-001'] }),
    ].map((entry) => withBrief(workspace, 'demo', entry)));
    await seedPlan(workspace, manifest({ changes: entries }));
    const read = async () => {
      const result = await runCli(['project', 'loop', 'demo', '--json'], workspace.projectRoot);
      expect(result.code).toBe(0);
      return parseJson(result.stdout);
    };
    expect((await read()).candidates).toHaveLength(1);
    for (const [index, entry] of entries.entries()) {
      expect((await read()).candidates[0]).toMatchObject({ id: entry.id, action: 'propose' });
      expect((await runCli(['new', 'change', entry.slug, '--json'], workspace.projectRoot)).code).toBe(0);
      expect((await runCli(['project', 'link', 'demo', entry.id, entry.slug, '--json'], workspace.projectRoot)).code).toBe(0);
      expect((await read()).candidates[0].action).toBe('continue');
      const dir = await seedChange(workspace, entry.slug, { capability: `cap-${index}` });
      expect((await read()).candidates[0].action).toBe('implement');
      await writeFile(path.join(dir, 'tasks.md'), '## Work\n- [x] 1.1 Verified work\n');
      expect((await read()).candidates[0].action).toBe('verify');
      expect((await runCli(['validate', entry.slug, '--strict', '--json'], workspace.projectRoot)).code).toBe(0);
      expect((await runCli(['archive', entry.slug, '--json'], workspace.projectRoot)).code).toBe(0);
    }
    expect(await read()).toMatchObject({ state: 'completed', completed: ['CH-001', 'CH-002'], remaining: [], candidates: [] });
  });

  it('uses the JSON error envelope for absent plans and exit zero for a blocked snapshot', async () => {
    const workspace = await makePlanWorkspace();
    const missing = await runCli(['project', 'loop', '--json'], workspace.projectRoot);
    expect(missing.code).toBe(1);
    expect(parseJson(missing.stdout)).toMatchObject({ plan: null, error: { code: 'plan_not_found' } });
    await seedPlan(workspace, manifest());
    const empty = await runCli(['project', '--json', 'loop'], workspace.projectRoot);
    expect(empty.code).toBe(0);
    expect(parseJson(empty.stdout).state).toBe('blocked');
  });
});
