import { afterEach, describe, expect, it } from 'vitest';
import { resolveChangeContext } from '../../src/core/change/status.js';
import { buildInstructions } from '../../src/core/change/instructions.js';
import { writeChangeMetadata } from '../../src/core/change/metadata.js';
import { makeWorkspace, seedChange } from '../helpers/workspace.js';

const ENV_KEY = 'SPECS_HARNESS';

describe('parallelDispatch — harness capability combined with change opt-in', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('is true only when the harness is capable AND the change opted in', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'demo');
    await writeChangeMetadata(dir, { schema: 'spec-driven', parallel: true });

    process.env[ENV_KEY] = 'claude';
    const context = await resolveChangeContext(workspace, 'demo');
    const instructions = await buildInstructions(context, 'implement');

    expect(instructions.kind).toBe('phase');
    if (instructions.kind === 'phase') {
      expect(instructions.parallelDispatch).toEqual({ supported: true, primitive: 'Task' });
    }
  });

  it('is false when the change never opted in, even under a capable harness', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'demo'); // no parallel: true written

    process.env[ENV_KEY] = 'claude';
    const context = await resolveChangeContext(workspace, 'demo');
    const instructions = await buildInstructions(context, 'implement');

    if (instructions.kind === 'phase') {
      expect(instructions.parallelDispatch?.supported).toBe(false);
    }
  });

  it('is false when the change opted in but the harness declares no primitive', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'demo');
    await writeChangeMetadata(dir, { schema: 'spec-driven', parallel: true });

    process.env[ENV_KEY] = 'codex';
    const context = await resolveChangeContext(workspace, 'demo');
    const instructions = await buildInstructions(context, 'implement');

    if (instructions.kind === 'phase') {
      expect(instructions.parallelDispatch?.supported).toBe(false);
    }
  });

  it('never appears on an ordinary artifact, only on the implement phase', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'demo');
    await writeChangeMetadata(dir, { schema: 'spec-driven', parallel: true });

    process.env[ENV_KEY] = 'claude';
    const context = await resolveChangeContext(workspace, 'demo');
    const instructions = await buildInstructions(context, 'proposal');

    expect((instructions as { parallelDispatch?: unknown }).parallelDispatch).toBeUndefined();
  });
});
