import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commitAll, git, makeGitWorkspace } from '../helpers/git.js';
import { seedChange, writeFile } from '../helpers/workspace.js';
import {
  assertMainWorktree,
  cleanupWorktree,
  createWorktree,
  finishWorktree,
  listWorktrees,
  resumeWorktree,
  withParallelLock,
} from '../../src/core/change/worktree.js';
import { readTaskProgress } from '../../src/core/change/model.js';
import { SpecError } from '../../src/util/errors.js';
import type { Workspace } from '../../src/core/workspace.js';

async function seedGitChange(workspace: Workspace, id: string, tasks: string): Promise<void> {
  await seedChange(workspace, id, { tasks });
  await commitAll(workspace.projectRoot, `seed ${id}`);
}

async function exists(target: string): Promise<boolean> {
  return fs.stat(target).then(
    () => true,
    () => false
  );
}

describe('createWorktree / finishWorktree — happy path', () => {
  it('isolates a task, merges committed work back, marks it done, and cleans up', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: src/x.ts`\n');

    const created = await createWorktree(workspace, 'demo', '1.1');
    expect(created.branch).toBe('specwright/demo/1.1');
    expect(await exists(created.path)).toBe(true);

    await writeFile(path.join(created.path, 'src', 'x.ts'), 'export const x = 1;\n');
    await git(['add', '-A'], created.path);
    await git(['commit', '-q', '-m', 'implement x'], created.path);

    const result = await finishWorktree(workspace, 'demo', '1.1');
    expect(result).toEqual({ merged: true, removed: true, remaining: 0 });

    const progress = await readTaskProgress(path.join(workspace.changesPath, 'demo'));
    expect(progress?.tasks[0].done).toBe(true);
    expect(await exists(created.path)).toBe(false);

    const branches = await git(['branch', '--list', 'specwright/demo/1.1'], workspace.projectRoot);
    expect(branches.stdout.trim()).toBe('');
  });

  it('adds .specwright/ to .git/info/exclude exactly once across several worktrees', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n- [ ] 1.2 Faz Y `files: b.ts`\n');

    await createWorktree(workspace, 'demo', '1.1');
    await createWorktree(workspace, 'demo', '1.2');

    const exclude = await fs.readFile(path.join(workspace.projectRoot, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('.specwright/').length - 1).toBe(1);
  });

  it('never writes to .gitignore', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    await createWorktree(workspace, 'demo', '1.1');
    expect(await exists(path.join(workspace.projectRoot, '.gitignore'))).toBe(false);
  });

  it('refuses a second active worktree for the same task', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    await createWorktree(workspace, 'demo', '1.1');
    await expect(createWorktree(workspace, 'demo', '1.1')).rejects.toThrow(/já existe um worktree ativo/i);
  });

  it('refuses to finish a worktree with uncommitted changes', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    const created = await createWorktree(workspace, 'demo', '1.1');
    await writeFile(path.join(created.path, 'a.ts'), 'uncommitted');

    await expect(finishWorktree(workspace, 'demo', '1.1')).rejects.toMatchObject({ code: 'worktree_dirty' });
  });

  it('refuses to finish a worktree whose branch has no commit ahead of its base', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    await createWorktree(workspace, 'demo', '1.1');

    await expect(finishWorktree(workspace, 'demo', '1.1')).rejects.toMatchObject({ code: 'worktree_no_changes' });
  });

  it('refuses to finish when the main tree itself has uncommitted changes', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    const created = await createWorktree(workspace, 'demo', '1.1');
    await writeFile(path.join(created.path, 'a.ts'), 'work');
    await git(['add', '-A'], created.path);
    await git(['commit', '-q', '-m', 'work'], created.path);

    await writeFile(path.join(workspace.projectRoot, 'stray.txt'), 'oops');

    await expect(finishWorktree(workspace, 'demo', '1.1')).rejects.toMatchObject({ code: 'main_tree_dirty' });
  });
});

describe('merge conflict and resume', () => {
  it('aborts cleanly on conflict, leaves the worktree intact, and resume closes the loop after a manual merge', async () => {
    const workspace = await makeGitWorkspace();
    await writeFile(path.join(workspace.projectRoot, 'shared.txt'), 'base\n');
    await commitAll(workspace.projectRoot, 'add shared.txt');
    await seedGitChange(
      workspace,
      'demo',
      '- [ ] 1.1 Faz A `files: shared.txt`\n- [ ] 1.2 Faz B `files: shared.txt`\n'
    );

    const a = await createWorktree(workspace, 'demo', '1.1');
    const b = await createWorktree(workspace, 'demo', '1.2');

    await writeFile(path.join(a.path, 'shared.txt'), 'A\n');
    await git(['commit', '-q', '-am', 'A'], a.path);
    await writeFile(path.join(b.path, 'shared.txt'), 'B\n');
    await git(['commit', '-q', '-am', 'B'], b.path);

    expect((await finishWorktree(workspace, 'demo', '1.1')).merged).toBe(true);

    const conflictResult = await finishWorktree(workspace, 'demo', '1.2');
    expect(conflictResult).toMatchObject({ merged: false, conflict: true, branch: 'specwright/demo/1.2' });

    // the main tree is clean and no merge is left hanging
    const status = await git(['status', '--porcelain'], workspace.projectRoot);
    expect(status.stdout.trim()).toBe('');
    expect(await exists(path.join(workspace.projectRoot, '.git', 'MERGE_HEAD'))).toBe(false);

    // the losing task is still unmarked, and its worktree is untouched
    const duringConflict = await readTaskProgress(path.join(workspace.changesPath, 'demo'));
    expect(duringConflict?.tasks.find((t) => t.number === '1.2')?.done).toBe(false);
    expect(await exists(b.path)).toBe(true);

    // resume before the human actually merges: refused, not attempted
    await expect(resumeWorktree(workspace, 'demo', '1.2')).rejects.toMatchObject({ code: 'merge_not_completed' });

    // human resolves by hand, in the main tree, with plain git
    await git(['merge', '--no-ff', 'specwright/demo/1.2'], workspace.projectRoot).catch(() => undefined);
    await writeFile(path.join(workspace.projectRoot, 'shared.txt'), 'A+B\n');
    await git(['add', 'shared.txt'], workspace.projectRoot);
    await git(['commit', '-q', '-m', 'resolve conflict'], workspace.projectRoot);

    const resumed = await resumeWorktree(workspace, 'demo', '1.2');
    expect(resumed).toMatchObject({ merged: true, removed: true, remaining: 0 });

    const final = await readTaskProgress(path.join(workspace.changesPath, 'demo'));
    expect(final?.tasks.every((t) => t.done)).toBe(true);
    expect(await exists(b.path)).toBe(false);
  });
});

describe('reconciliation self-heals a crash between merge and bookkeeping', () => {
  it('recovers a registry stuck in "merging" whose merge had actually already landed', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    const created = await createWorktree(workspace, 'demo', '1.1');
    await writeFile(path.join(created.path, 'a.ts'), 'x');
    await git(['add', '-A'], created.path);
    await git(['commit', '-q', '-m', 'work'], created.path);

    // simulate `finish` crashing right after the merge commit landed, before
    // it could write tasks.md or advance the registry past "merging".
    await git(['merge', '--no-ff', '-m', 'merge', 'specwright/demo/1.1'], workspace.projectRoot);
    const registryFile = path.join(
      workspace.projectRoot,
      '.specwright',
      'parallel',
      'demo',
      'worktrees',
      '1.1.json'
    );
    const entry = JSON.parse(await fs.readFile(registryFile, 'utf8'));
    await fs.writeFile(registryFile, JSON.stringify({ ...entry, status: 'merging' }));

    const before = await readTaskProgress(path.join(workspace.changesPath, 'demo'));
    expect(before?.tasks[0].done).toBe(false);

    const list = await listWorktrees(workspace, 'demo');
    expect(list.worktrees).toHaveLength(0);

    const after = await readTaskProgress(path.join(workspace.changesPath, 'demo'));
    expect(after?.tasks[0].done).toBe(true);
    expect(await exists(created.path)).toBe(false);
  });

  it('recovers a registry stuck in "merging" whose merge never actually applied', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    const created = await createWorktree(workspace, 'demo', '1.1');
    await writeFile(path.join(created.path, 'a.ts'), 'x');
    await git(['add', '-A'], created.path);
    await git(['commit', '-q', '-m', 'work'], created.path);

    const registryFile = path.join(
      workspace.projectRoot,
      '.specwright',
      'parallel',
      'demo',
      'worktrees',
      '1.1.json'
    );
    const entry = JSON.parse(await fs.readFile(registryFile, 'utf8'));
    await fs.writeFile(registryFile, JSON.stringify({ ...entry, status: 'merging' }));

    const list = await listWorktrees(workspace, 'demo');
    expect(list.worktrees).toEqual([expect.objectContaining({ task: '1.1', status: 'active' })]);

    // a fresh finish now works normally
    const result = await finishWorktree(workspace, 'demo', '1.1');
    expect(result.merged).toBe(true);
  });
});

describe('cleanup', () => {
  it('refuses to remove an unmerged worktree without --force, and removes a merged one', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n- [ ] 1.2 Faz Y `files: b.ts`\n');

    const a = await createWorktree(workspace, 'demo', '1.1');
    await writeFile(path.join(a.path, 'a.ts'), 'x');
    await git(['add', '-A'], a.path);
    await git(['commit', '-q', '-m', 'work'], a.path);

    const cleaned = await cleanupWorktree(workspace, 'demo', { task: '1.1' });
    expect(cleaned).toEqual({ removed: [], skipped: [{ task: '1.1', reason: 'not_merged' }] });
    expect(await exists(a.path)).toBe(true);

    const forced = await cleanupWorktree(workspace, 'demo', { task: '1.1', force: true });
    expect(forced.removed).toEqual(['1.1']);
    expect(await exists(a.path)).toBe(false);
  });
});

describe('assertMainWorktree', () => {
  it('refuses a workspace whose project root is a linked worktree, not the main tree', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    const created = await createWorktree(workspace, 'demo', '1.1');

    await expect(assertMainWorktree(created.path)).rejects.toBeInstanceOf(SpecError);
    await expect(assertMainWorktree(created.path)).rejects.toMatchObject({ code: 'must_run_from_main_worktree' });

    // and every public entry point inherits the same guard
    const fakeWorkspace: Workspace = { ...workspace, projectRoot: created.path };
    await expect(listWorktrees(fakeWorkspace, 'demo')).rejects.toMatchObject({
      code: 'must_run_from_main_worktree',
    });
  });
});

describe('withParallelLock', () => {
  it('serializes concurrent critical sections for the same change', async () => {
    const workspace = await makeGitWorkspace();
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = () =>
      withParallelLock(workspace.projectRoot, 'demo', async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 20));
        concurrent -= 1;
      });

    await Promise.all([task(), task(), task()]);
    expect(maxConcurrent).toBe(1);
  });
});
