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

  it('keeps the merge commit and the task-completion commit distinct, in that order', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    const created = await createWorktree(workspace, 'demo', '1.1');
    await writeFile(path.join(created.path, 'a.ts'), 'x');
    await git(['add', '-A'], created.path);
    await git(['commit', '-q', '-m', 'implement'], created.path);
    const branchTip = (await git(['rev-parse', 'specwright/demo/1.1'], workspace.projectRoot)).stdout.trim();

    await finishWorktree(workspace, 'demo', '1.1');

    const log = await git(['log', '--format=%H %P', '-n', '2'], workspace.projectRoot);
    const [completionLine, mergeLine] = log.stdout.trim().split('\n');
    const completionSha = completionLine.split(' ')[0];
    const [mergeSha, ...mergeParents] = mergeLine.split(' ');
    expect(completionSha).not.toBe(mergeSha);
    expect(mergeParents).toContain(branchTip);
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

  it('reports a real commit failure instead of silently treating it as "nothing to do"', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    const created = await createWorktree(workspace, 'demo', '1.1');
    await writeFile(path.join(created.path, 'a.ts'), 'work');
    await git(['add', '-A'], created.path);
    await git(['commit', '-q', '-m', 'work'], created.path);

    // pre-commit does not gate a clean merge commit (only pre-merge-commit
    // does), so the merge itself still succeeds - only the follow-up
    // "mark task done" commit this hook is meant to simulate a real failure
    // of is affected. `core.hooksPath` is forced back to the repo's own
    // `.git/hooks` because a machine-wide override (a global gitconfig
    // pointing hooks elsewhere) would otherwise make this hook a no-op.
    await git(['config', 'core.hooksPath', '.git/hooks'], workspace.projectRoot);
    const hookPath = path.join(workspace.projectRoot, '.git', 'hooks', 'pre-commit');
    await writeFile(hookPath, '#!/bin/sh\nexit 1\n');
    await fs.chmod(hookPath, 0o755);

    await expect(finishWorktree(workspace, 'demo', '1.1')).rejects.toMatchObject({
      code: 'task_completion_commit_failed',
    });
  });
});

describe('createWorktree — input validation', () => {
  it('refuses a change that does not exist', async () => {
    const workspace = await makeGitWorkspace();
    await expect(createWorktree(workspace, 'ghost', '1.1')).rejects.toMatchObject({ code: 'change_not_found' });
  });

  it('refuses a task number tasks.md never declared', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    await expect(createWorktree(workspace, 'demo', '9.9')).rejects.toMatchObject({ code: 'task_not_found' });
  });

  it('refuses a change id that attempts path traversal', async () => {
    const workspace = await makeGitWorkspace();
    await expect(createWorktree(workspace, '../../etc', '1.1')).rejects.toMatchObject({
      code: 'invalid_change_name',
    });
  });

  it('refuses a task number that attempts path traversal', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    await expect(createWorktree(workspace, 'demo', '../../etc/passwd')).rejects.toMatchObject({
      code: 'invalid_task_number',
    });
  });

  it('reports a corrupted registry file with a structured, recoverable error', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    await createWorktree(workspace, 'demo', '1.1');

    const registryFile = path.join(
      workspace.projectRoot,
      '.specwright',
      'parallel',
      'demo',
      'worktrees',
      '1.1.json'
    );
    await fs.writeFile(registryFile, '{not valid json');

    await expect(createWorktree(workspace, 'demo', '1.1')).rejects.toMatchObject({
      code: 'worktree_registry_corrupt',
    });
  });

  it('rolls back the git worktree it just created when a later step in the same create fails', async () => {
    const workspace = await makeGitWorkspace();
    await seedGitChange(workspace, 'demo', '- [ ] 1.1 Faz X `files: a.ts`\n');
    // a file git already tracks makes the --link step fail deterministically,
    // after `git worktree add` has already succeeded.
    await writeFile(path.join(workspace.projectRoot, 'tracked.txt'), 'x');
    await commitAll(workspace.projectRoot, 'add tracked.txt');

    await expect(createWorktree(workspace, 'demo', '1.1', { link: ['tracked.txt'] })).rejects.toMatchObject({
      code: 'link_target_tracked',
    });

    const list = await git(['worktree', 'list', '--porcelain'], workspace.projectRoot);
    expect(list.stdout).not.toContain(path.join('.specwright', 'worktrees', 'demo', '1.1'));
    expect(await exists(path.join(workspace.projectRoot, '.specwright', 'worktrees', 'demo', '1.1'))).toBe(false);
    const branches = await git(['branch', '--list', 'specwright/demo/1.1'], workspace.projectRoot);
    expect(branches.stdout.trim()).toBe('');

    // and a retry, without the mistake, works normally
    const created = await createWorktree(workspace, 'demo', '1.1');
    expect(await exists(created.path)).toBe(true);
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
