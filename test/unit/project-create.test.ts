import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlan } from '../../src/core/project/create.js';
import { loadPlan, savePlan } from '../../src/core/project/repository.js';
import { planPaths } from '../../src/core/project/paths.js';
import { sha256 } from '../../src/core/project/hashes.js';
import { makePlanWorkspace } from '../helpers/plan.js';
import { writeFile } from '../helpers/workspace.js';

describe('createPlan', () => {
  it('creates the plan tree with a draft manifest at revision 0', async () => {
    const workspace = await makePlanWorkspace();
    const result = await createPlan(workspace.projectRoot, 'ecommerce', { name: 'E-commerce' });

    expect(result).toMatchObject({ plan: 'ecommerce', revision: 0, path: 'planning/ecommerce' });

    const { manifest } = await loadPlan(workspace.projectRoot, 'ecommerce');
    expect(manifest).toMatchObject({
      schema_version: 1,
      revision: 0,
      status: 'draft',
      name: 'E-commerce',
      changes: [],
    });

    for (const relative of ['plan.yaml', 'plan.md', 'architecture.md']) {
      expect(await fs.stat(path.join(workspace.projectRoot, 'planning/ecommerce', relative))).toBeDefined();
    }
    expect(
      (await fs.stat(path.join(workspace.projectRoot, 'planning/ecommerce/planned-changes'))).isDirectory()
    ).toBe(true);
  });

  it('does not touch spec/ files', async () => {
    const workspace = await makePlanWorkspace();
    const configBefore = await fs.readFile(workspace.configPath, 'utf8');
    await createPlan(workspace.projectRoot, 'ecommerce', {});
    expect(await fs.readFile(workspace.configPath, 'utf8')).toBe(configBefore);
  });

  it('records a source path relative to the root plus its sha256', async () => {
    const workspace = await makePlanWorkspace();
    await writeFile(path.join(workspace.projectRoot, 'docs/product/ecommerce.md'), '# Visão\n\nconteúdo\n');
    await createPlan(workspace.projectRoot, 'ecommerce', {
      sources: ['docs/product/ecommerce.md'],
    });
    const { manifest } = await loadPlan(workspace.projectRoot, 'ecommerce');
    expect(manifest.source_documents[0]).toEqual({
      path: 'docs/product/ecommerce.md',
      sha256: sha256('# Visão\n\nconteúdo\n'),
    });
    expect(manifest.created_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is idempotent by refusal and modifies nothing on a second run', async () => {
    const workspace = await makePlanWorkspace();
    await createPlan(workspace.projectRoot, 'ecommerce', { name: 'First' });
    const manifestPath = path.join(workspace.projectRoot, 'planning/ecommerce/plan.yaml');
    const bytesBefore = await fs.readFile(manifestPath, 'utf8');

    await expect(createPlan(workspace.projectRoot, 'ecommerce', { name: 'Second' })).rejects.toMatchObject({
      code: 'plan_exists',
    });
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(bytesBefore);
  });

  it('rejects an unsafe source path', async () => {
    const workspace = await makePlanWorkspace();
    await expect(
      createPlan(workspace.projectRoot, 'ecommerce', { sources: ['../secret.md'] })
    ).rejects.toMatchObject({ code: 'unsafe_source_path' });
  });

  it('rejects a non kebab-case plan id', async () => {
    const workspace = await makePlanWorkspace();
    await expect(createPlan(workspace.projectRoot, 'E_Commerce', {})).rejects.toMatchObject({
      code: 'invalid_plan',
    });
  });

  it('savePlan bumps revision and refreshes updated_at, and honours expectRevision', async () => {
    const workspace = await makePlanWorkspace();
    await createPlan(workspace.projectRoot, 'p', {});
    const paths = planPaths(workspace.projectRoot, 'p');
    const { manifest } = await loadPlan(workspace.projectRoot, 'p');

    const saved = await savePlan(paths, manifest, { now: new Date('2027-01-02T10:00:00') });
    expect(saved.revision).toBe(1);
    expect(saved.updated_at).toBe('2027-01-02');

    await expect(savePlan(paths, saved, { expectRevision: 0 })).rejects.toMatchObject({
      code: 'plan_revision_conflict',
    });
  });

  it('round-trips: the written manifest reloads and re-serializes identically', async () => {
    const workspace = await makePlanWorkspace();
    await createPlan(workspace.projectRoot, 'ecommerce', { name: 'E-commerce', owner: 'team' });
    const first = await loadPlan(workspace.projectRoot, 'ecommerce');
    const { renderManifest } = await import('../../src/core/project/model.js');
    expect(renderManifest(first.manifest)).toBe(first.raw);
  });
});
