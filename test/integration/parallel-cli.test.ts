import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitAll, git, makeGitWorkspace } from '../helpers/git.js';
import { parseJson, runCli, seedChange, writeFile } from '../helpers/workspace.js';

describe('specs tasks / specs worktree — end to end through the built CLI', () => {
  it('computes a batch, isolates a task in a worktree, and merges it back on `finish`', async () => {
    const workspace = await makeGitWorkspace();
    await seedChange(workspace, 'demo', {
      tasks: '- [ ] 1.1 Faz X `files: src/x.ts`\n- [ ] 1.2 Faz Y `files: src/y.ts`\n',
    });
    await commitAll(workspace.projectRoot, 'seed demo');

    const ready = await runCli(['tasks', 'ready', '--change', 'demo', '--json'], workspace.projectRoot);
    expect(ready.code).toBe(0);
    const readyBody = parseJson<{ batch: { number: string }[] }>(ready.stdout);
    expect(readyBody.batch.map((t) => t.number).sort()).toEqual(['1.1', '1.2']);

    const create = await runCli(
      ['worktree', 'create', '--change', 'demo', '--task', '1.1', '--json'],
      workspace.projectRoot
    );
    expect(create.code).toBe(0);
    const created = parseJson<{ path: string; branch: string }>(create.stdout);
    expect(created.branch).toBe('specwright/demo/1.1');

    await writeFile(path.join(created.path, 'src', 'x.ts'), 'export const x = 1;\n');
    await git(['add', '-A'], created.path);
    await git(['commit', '-q', '-m', 'implement x'], created.path);

    const finish = await runCli(
      ['worktree', 'finish', '--change', 'demo', '--task', '1.1', '--json'],
      workspace.projectRoot
    );
    expect(finish.code).toBe(0);
    expect(parseJson(finish.stdout)).toMatchObject({ merged: true, removed: true, remaining: 1 });

    const status = await runCli(['status', '--change', 'demo', '--json'], workspace.projectRoot);
    expect(parseJson<{ tasks: { completed: number; total: number } }>(status.stdout).tasks).toMatchObject({
      completed: 1,
      total: 2,
    });
  });

  it('marks a task done sequentially with `specs tasks complete`, without any worktree', async () => {
    const workspace = await makeGitWorkspace();
    await seedChange(workspace, 'demo', { tasks: '- [ ] 1.1 Faz X\n' });
    await commitAll(workspace.projectRoot, 'seed demo');

    const complete = await runCli(
      ['tasks', 'complete', '--change', 'demo', '--task', '1.1', '--json'],
      workspace.projectRoot
    );
    expect(complete.code).toBe(0);
    expect(parseJson(complete.stdout)).toEqual({ change: 'demo', task: '1.1', done: true, remaining: 0 });
  });

  it('reports a JSON error, not a stack trace, for an unknown task', async () => {
    const workspace = await makeGitWorkspace();
    await seedChange(workspace, 'demo', { tasks: '- [ ] 1.1 Faz X\n' });
    await commitAll(workspace.projectRoot, 'seed demo');

    const complete = await runCli(
      ['tasks', 'complete', '--change', 'demo', '--task', '9.9', '--json'],
      workspace.projectRoot
    );
    expect(complete.code).toBe(1);
    expect(parseJson<{ error: { code: string } }>(complete.stdout).error.code).toBe('task_not_found');
  });

  it('refuses `specs tasks ready` and `specs tasks complete` when cwd is inside a linked worktree', async () => {
    const workspace = await makeGitWorkspace();
    await seedChange(workspace, 'demo', {
      tasks: '- [ ] 1.1 Faz X `files: src/x.ts`\n- [ ] 1.2 Faz Y `files: src/y.ts`\n',
    });
    await commitAll(workspace.projectRoot, 'seed demo');

    const create = await runCli(
      ['worktree', 'create', '--change', 'demo', '--task', '1.1', '--json'],
      workspace.projectRoot
    );
    const created = parseJson<{ path: string }>(create.stdout);

    const readyFromWorktree = await runCli(['tasks', 'ready', '--change', 'demo', '--json'], created.path);
    expect(readyFromWorktree.code).toBe(1);
    expect(parseJson<{ error: { code: string } }>(readyFromWorktree.stdout).error.code).toBe(
      'must_run_from_main_worktree'
    );

    const completeFromWorktree = await runCli(
      ['tasks', 'complete', '--change', 'demo', '--task', '1.2', '--json'],
      created.path
    );
    expect(completeFromWorktree.code).toBe(1);
    expect(parseJson<{ error: { code: string } }>(completeFromWorktree.stdout).error.code).toBe(
      'must_run_from_main_worktree'
    );
  });
});

describe('specs worktree --whole-change — end to end through the built CLI', () => {
  it('refuses create/finish/resume with neither --task nor --whole-change', async () => {
    const workspace = await makeGitWorkspace();
    await seedChange(workspace, 'demo');
    await commitAll(workspace.projectRoot, 'seed demo');

    const create = await runCli(['worktree', 'create', '--change', 'demo', '--json'], workspace.projectRoot);
    expect(create.code).toBe(1);
    expect(parseJson<{ error: { code: string } }>(create.stdout).error.code).toBe('invalid_worktree_unit');
  });

  it('isolates and merges a whole change, and leaves --task-less list/cleanup behaving as before', async () => {
    const workspace = await makeGitWorkspace();
    await seedChange(workspace, 'demo', { tasks: '- [ ] 1.1 Faz X `files: src/x.ts`\n' });
    await commitAll(workspace.projectRoot, 'seed demo');

    const create = await runCli(
      ['worktree', 'create', '--change', 'demo', '--whole-change', '--json'],
      workspace.projectRoot
    );
    expect(create.code).toBe(0);
    const created = parseJson<{ path: string; branch: string }>(create.stdout);
    expect(created.branch).toBe('specwright-change/demo');

    // `list`/`cleanup` without --whole-change keep meaning "task worktrees of
    // this change" - unchanged from before --whole-change existed. No task
    // worktree exists here, so this must come back empty, not see the
    // change-level one.
    const taskList = await runCli(['worktree', 'list', '--change', 'demo', '--json'], workspace.projectRoot);
    expect(taskList.code).toBe(0);
    expect(parseJson<{ worktrees: unknown[] }>(taskList.stdout).worktrees).toEqual([]);

    const wholeList = await runCli(['worktree', 'list', '--whole-change', '--json'], workspace.projectRoot);
    expect(wholeList.code).toBe(0);
    const wholeListed = parseJson<{ worktrees: { change: string; status: string }[] }>(wholeList.stdout);
    expect(wholeListed.worktrees).toEqual([{ change: 'demo', status: 'active', existsOnDisk: true, path: created.path, branch: created.branch }]);

    await writeFile(path.join(created.path, 'src', 'x.ts'), 'export const x = 1;\n');
    await git(['add', '-A'], created.path);
    await git(['commit', '-q', '-m', 'implement'], created.path);

    const finish = await runCli(
      ['worktree', 'finish', '--change', 'demo', '--whole-change', '--json'],
      workspace.projectRoot
    );
    expect(finish.code).toBe(0);
    expect(parseJson<{ merged: boolean }>(finish.stdout).merged).toBe(true);
  });
});
