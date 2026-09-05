import { afterEach, describe, expect, it } from 'vitest';
import { resolveChangeContext } from '../../src/core/change/status.js';
import { buildInstructions } from '../../src/core/change/instructions.js';
import { writeChangeMetadata } from '../../src/core/change/metadata.js';
import { createChangeWorktree } from '../../src/core/change/worktree.js';
import { workspaceAt } from '../../src/core/workspace.js';
import { commitAll, makeGitWorkspace } from '../helpers/git.js';
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

  it('is false from inside a change-level worktree, even for a capable harness and an opted-in change', async () => {
    // Isolation cannot recurse: a subagent dispatched into its own
    // change-level worktree (by the batch `next.ts` recommends) must not be
    // told it can fan out to per-task worktrees of its own - every worktree
    // command refuses to run from anywhere but the repo's real main tree.
    const workspace = await makeGitWorkspace();
    const dir = await seedChange(workspace, 'demo');
    await writeChangeMetadata(dir, { schema: 'spec-driven', parallel: true });
    await commitAll(workspace.projectRoot, 'seed demo');

    process.env[ENV_KEY] = 'claude';

    // From the main tree, it does read as supported...
    const mainContext = await resolveChangeContext(workspace, 'demo');
    const fromMain = await buildInstructions(mainContext, 'implement');
    if (fromMain.kind === 'phase') {
      expect(fromMain.parallelDispatch?.supported).toBe(true);
    }

    // ...but from inside the change's own isolated worktree, it must not.
    const created = await createChangeWorktree(workspace, 'demo');
    const worktreeWorkspace = workspaceAt(created.path);
    const worktreeContext = await resolveChangeContext(worktreeWorkspace, 'demo');
    const fromWorktree = await buildInstructions(worktreeContext, 'implement');
    if (fromWorktree.kind === 'phase') {
      expect(fromWorktree.parallelDispatch?.supported).toBe(false);
    }
  });
});
