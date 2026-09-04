import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { SpecError } from '../../util/errors.js';
import { ensureDir, pathExists, readFileIfExists, writeFileAtomic } from '../../util/fs.js';
import { changeDir, type Workspace } from '../workspace.js';
import { markTaskDone, readTaskProgress, TASKS_FILE } from './model.js';

export type WorktreeStatus = 'active' | 'merging' | 'merge_conflict' | 'cleanup_pending';

export interface WorktreeEntry {
  task: string;
  branch: string;
  /** Absolute. */
  path: string;
  /** HEAD of the main tree at creation time - the reconciliation anchor. */
  baseSha: string;
  createdAt: string;
  status: WorktreeStatus;
  mergeCommitSha?: string;
}

export interface CreateWorktreeOptions {
  /** Paths, relative to the project root, to symlink into the new worktree. */
  link?: string[];
}

export interface FinishResult {
  merged: boolean;
  removed?: boolean;
  remaining?: number;
  conflict?: boolean;
  path?: string;
  branch?: string;
}

export interface WorktreeListEntry {
  task: string;
  branch: string;
  path: string;
  status: WorktreeStatus;
  existsOnDisk: boolean;
}

export interface WorktreeListResult {
  worktrees: WorktreeListEntry[];
  unregistered: { path: string; branch?: string }[];
}

export interface CleanupOptions {
  task?: string;
  force?: boolean;
}

export interface CleanupResult {
  removed: string[];
  skipped: { task: string; reason: string }[];
}

// --- paths ---------------------------------------------------------------

function parallelDir(projectRoot: string, changeId: string): string {
  return path.join(projectRoot, '.specwright', 'parallel', changeId);
}

function registryPath(projectRoot: string, changeId: string, task: string): string {
  return path.join(parallelDir(projectRoot, changeId), 'worktrees', `${task}.json`);
}

function lockPath(projectRoot: string, changeId: string): string {
  return path.join(parallelDir(projectRoot, changeId), '.lock');
}

function worktreePath(projectRoot: string, changeId: string, task: string): string {
  return path.join(projectRoot, '.specwright', 'worktrees', changeId, task);
}

function branchName(changeId: string, task: string): string {
  return `specwright/${changeId}/${task}`;
}

// --- git plumbing ----------------------------------------------------------
//
// Spawned with `shell: false` and awaited asynchronously - never `execSync`.
// A synchronous call here would block the whole process if `git worktree add`
// or `git merge` triggers a hook or credential helper that waits on stdin,
// which is a real thing git hooks do. `runGit` never rejects: a spawn failure
// (git missing, permissions) resolves as `ok: false` like any other git
// failure, so every call site has exactly one thing to check.

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

function runGit(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, { cwd, shell: false });
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: String(error), code: null });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => resolve({ ok: false, stdout, stderr: String(error), code: null }));
    child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr, code }));
  });
}

interface GitWorktreeInfo {
  path: string;
  branch?: string;
  isMain: boolean;
}

/** Always re-derived from git, never cached - a stale cache is worse than a slower read. */
async function listGitWorktrees(cwd: string): Promise<GitWorktreeInfo[]> {
  const result = await runGit(['worktree', 'list', '--porcelain'], cwd);
  if (!result.ok) {
    throw new SpecError('Não foi possível listar os worktrees do git — este diretório é um repositório git?', {
      code: 'not_a_git_repo',
    });
  }

  const raw: { path: string; branch?: string }[] = [];
  let current: { path: string; branch?: string } | null = null;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) raw.push(current);
      current = { path: line.slice('worktree '.length).trim() };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim();
    }
  }
  if (current) raw.push(current);
  // git always lists the main working tree first.
  return raw.map((entry, index) => ({ ...entry, isMain: index === 0 }));
}

async function resolveGitCommonDir(cwd: string): Promise<string> {
  const result = await runGit(['rev-parse', '--git-common-dir'], cwd);
  if (!result.ok) {
    throw new SpecError('Não foi possível localizar o diretório .git', { code: 'not_a_git_repo' });
  }
  const raw = result.stdout.trim();
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}

/**
 * Refuses to proceed unless the caller is standing in the git repository's
 * main working tree. This is the guard, not just a prompt instruction, that
 * keeps a subagent running inside its own isolated worktree from mutating
 * shared coordination state: every public function in this module calls it
 * first.
 */
export async function assertMainWorktree(projectRoot: string): Promise<void> {
  const worktrees = await listGitWorktrees(projectRoot);
  const main = worktrees.find((entry) => entry.isMain);
  if (!main) return;

  const [resolvedMain, resolvedCwd] = await Promise.all([
    fs.realpath(main.path).catch(() => path.resolve(main.path)),
    fs.realpath(projectRoot).catch(() => path.resolve(projectRoot)),
  ]);
  if (resolvedMain !== resolvedCwd) {
    throw new SpecError('Este comando só roda a partir da árvore principal, não de um worktree isolado', {
      code: 'must_run_from_main_worktree',
    });
  }
}

const EXCLUDE_MARKER = '# specwright (gerado automaticamente)';

/**
 * Keeps `.specwright/` out of `git status` without touching the user's own
 * `.gitignore` - a per-clone, never-committed exclude list is the right place
 * for a tool's own runtime directory. Idempotent: safe to call on every
 * worktree creation.
 */
async function ensureExcluded(gitCommonDir: string): Promise<void> {
  const excludePath = path.join(gitCommonDir, 'info', 'exclude');
  const current = (await readFileIfExists(excludePath)) ?? '';
  if (current.includes('.specwright/')) return;
  const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
  await ensureDir(path.dirname(excludePath));
  await fs.appendFile(excludePath, `${separator}\n${EXCLUDE_MARKER}\n.specwright/\n`, 'utf8');
}

// --- registry --------------------------------------------------------------

async function readRegistry(projectRoot: string, changeId: string, task: string): Promise<WorktreeEntry | undefined> {
  const raw = await readFileIfExists(registryPath(projectRoot, changeId, task));
  if (raw === undefined) return undefined;
  return JSON.parse(raw) as WorktreeEntry;
}

async function writeRegistry(projectRoot: string, changeId: string, entry: WorktreeEntry): Promise<void> {
  await writeFileAtomic(registryPath(projectRoot, changeId, entry.task), JSON.stringify(entry, null, 2));
}

async function deleteRegistry(projectRoot: string, changeId: string, task: string): Promise<void> {
  await fs.rm(registryPath(projectRoot, changeId, task), { force: true });
}

async function listRegisteredTasks(projectRoot: string, changeId: string): Promise<string[]> {
  const dir = path.join(parallelDir(projectRoot, changeId), 'worktrees');
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort();
}

/**
 * Marks the task done and commits that single-file change in the main tree
 * right away, so the main tree is never left dirty between one task's finish
 * and the next one's preflight check - `markTaskDone` alone only touches the
 * working copy. Idempotent: if a previous attempt already committed this
 * (crash recovery re-running the same step), `git commit` finds nothing
 * staged and fails harmlessly, which this ignores by design.
 */
async function commitTaskCompletion(projectRoot: string, changeDirPath: string, task: string): Promise<void> {
  await markTaskDone(changeDirPath, task);
  const relativeTasksFile = path.relative(projectRoot, path.join(changeDirPath, TASKS_FILE));
  await runGit(['add', relativeTasksFile], projectRoot);
  await runGit(['commit', '-q', '-m', `specwright: marca a tarefa ${task} concluída`], projectRoot);
}

/**
 * Resolves a registry entry that might be mid-flight into a settled one,
 * recovering from a crash at any checkpoint `finishWorktree` writes:
 *
 * - `merging` whose branch is already an ancestor of HEAD means the merge
 *   landed before the process died; the task is marked done (idempotently)
 *   and cleanup proceeds as if `finish` had completed normally.
 * - `merging` whose branch is NOT an ancestor of HEAD means the merge never
 *   applied (or was aborted without the registry catching up); it is safe to
 *   drop back to `active` and let a fresh `finish` try again.
 * - `cleanup_pending` means the task is already marked done; only the
 *   worktree/branch removal might still be outstanding, which this retries.
 *
 * Returns the entry as it stands once `active` or `merge_conflict` (a state
 * this function never resolves on its own), or `undefined` once nothing is
 * left to reconcile.
 */
async function reconcile(
  projectRoot: string,
  changeDirPath: string,
  changeId: string,
  task: string
): Promise<WorktreeEntry | undefined> {
  let entry = await readRegistry(projectRoot, changeId, task);
  if (!entry) return undefined;

  if (entry.status === 'merging') {
    const ancestor = await runGit(['merge-base', '--is-ancestor', entry.branch, 'HEAD'], projectRoot);
    entry = { ...entry, status: ancestor.ok ? 'cleanup_pending' : 'active' };
    if (ancestor.ok) await commitTaskCompletion(projectRoot, changeDirPath, task);
    await writeRegistry(projectRoot, changeId, entry);
  }

  if (entry.status === 'cleanup_pending') {
    await runGit(['worktree', 'remove', entry.path], projectRoot);
    await runGit(['branch', '-d', entry.branch], projectRoot);
    await deleteRegistry(projectRoot, changeId, task);
    return undefined;
  }

  return entry;
}

// --- lock --------------------------------------------------------------

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5000;

/**
 * Serializes every registry-mutating operation for one change across
 * processes - not just within a session. Coordination between a controller
 * subagent loop and, separately, a human running `specs worktree` by hand
 * from another terminal on the same change needs this; a single in-session
 * controller alone would not.
 */
export async function withParallelLock<T>(
  projectRoot: string,
  changeId: string,
  fn: () => Promise<T>
): Promise<T> {
  const target = lockPath(projectRoot, changeId);
  await ensureDir(path.dirname(target));
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      const handle = await fs.open(target, 'wx');
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() > deadline) {
        throw new SpecError('Tempo esgotado esperando o lock de coordenação de worktree', {
          code: 'parallel_lock_timeout',
          fix: `Remova ${target} manualmente se nenhum processo o segura`,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }

  try {
    return await fn();
  } finally {
    await fs.rm(target, { force: true });
  }
}

// --- public API --------------------------------------------------------------

export async function createWorktree(
  workspace: Workspace,
  changeId: string,
  task: string,
  options: CreateWorktreeOptions = {}
): Promise<{ task: string; branch: string; path: string }> {
  const projectRoot = workspace.projectRoot;
  await assertMainWorktree(projectRoot);
  const changeDirPath = changeDir(workspace, changeId);

  const gitCommonDir = await resolveGitCommonDir(projectRoot);
  await ensureExcluded(gitCommonDir);

  return withParallelLock(projectRoot, changeId, async () => {
    const existing = await reconcile(projectRoot, changeDirPath, changeId, task);
    if (existing) {
      throw new SpecError(`Já existe um worktree ativo para a tarefa "${task}" (status: ${existing.status})`, {
        code: 'worktree_already_active',
        fix: existing.status === 'merge_conflict' ? 'specs worktree resume' : undefined,
      });
    }

    const targetPath = worktreePath(projectRoot, changeId, task);
    if (await pathExists(targetPath)) {
      throw new SpecError(`O diretório do worktree já existe sem estar registrado: ${targetPath}`, {
        code: 'worktree_already_active',
        fix: `specs worktree cleanup --change ${changeId} --task ${task} --force`,
      });
    }

    const head = await runGit(['rev-parse', 'HEAD'], projectRoot);
    if (!head.ok) {
      throw new SpecError('Não foi possível resolver HEAD da árvore principal', { code: 'not_a_git_repo' });
    }
    const baseSha = head.stdout.trim();
    const branch = branchName(changeId, task);

    const add = await runGit(['worktree', 'add', '-b', branch, targetPath, 'HEAD'], projectRoot);
    if (!add.ok) {
      throw new SpecError(`"git worktree add" falhou: ${add.stderr.trim()}`, { code: 'git_worktree_add_failed' });
    }

    for (const relative of options.link ?? []) {
      const tracked = await runGit(['ls-files', '--error-unmatch', relative], projectRoot);
      if (tracked.ok) {
        throw new SpecError(`"${relative}" é rastreado pelo git — não pode virar link simbólico`, {
          code: 'link_target_tracked',
        });
      }
      const source = path.join(projectRoot, relative);
      if (await pathExists(source)) {
        const destination = path.join(targetPath, relative);
        await ensureDir(path.dirname(destination));
        await fs.symlink(path.resolve(source), destination, 'dir');
      }
    }

    await writeRegistry(projectRoot, changeId, {
      task,
      branch,
      path: targetPath,
      baseSha,
      createdAt: new Date().toISOString(),
      status: 'active',
    });

    return { task, branch, path: targetPath };
  });
}

async function finalizeAfterMerge(
  projectRoot: string,
  changeDirPath: string,
  changeId: string,
  entry: WorktreeEntry
): Promise<FinishResult> {
  await commitTaskCompletion(projectRoot, changeDirPath, entry.task);
  const head = await runGit(['rev-parse', 'HEAD'], projectRoot);

  await writeRegistry(projectRoot, changeId, {
    ...entry,
    status: 'cleanup_pending',
    mergeCommitSha: head.ok ? head.stdout.trim() : entry.mergeCommitSha,
  });

  await runGit(['worktree', 'remove', entry.path], projectRoot);
  await runGit(['branch', '-d', entry.branch], projectRoot);
  await deleteRegistry(projectRoot, changeId, entry.task);

  const progress = await readTaskProgress(changeDirPath);
  return { merged: true, removed: true, remaining: progress ? progress.total - progress.completed : 0 };
}

export async function finishWorktree(workspace: Workspace, changeId: string, task: string): Promise<FinishResult> {
  const projectRoot = workspace.projectRoot;
  await assertMainWorktree(projectRoot);
  const changeDirPath = changeDir(workspace, changeId);

  return withParallelLock(projectRoot, changeId, async () => {
    const entry = await reconcile(projectRoot, changeDirPath, changeId, task);
    if (!entry) {
      throw new SpecError(`Não há worktree ativo para a tarefa "${task}"`, { code: 'worktree_not_found' });
    }
    if (entry.status !== 'active') {
      throw new SpecError(`Worktree da tarefa "${task}" está em "${entry.status}", não "active"`, {
        code: 'worktree_invalid_state',
        fix: entry.status === 'merge_conflict' ? 'specs worktree resume' : undefined,
      });
    }

    const gitCommonDir = await resolveGitCommonDir(projectRoot);
    if (await pathExists(path.join(gitCommonDir, 'MERGE_HEAD'))) {
      throw new SpecError('Já existe um merge em andamento na árvore principal', { code: 'merge_in_progress' });
    }

    const mainDirty = await runGit(['status', '--porcelain'], projectRoot);
    if (mainDirty.stdout.trim().length > 0) {
      throw new SpecError('A árvore principal tem alterações não commitadas — resolva antes de mesclar', {
        code: 'main_tree_dirty',
      });
    }

    const dirty = await runGit(['status', '--porcelain'], entry.path);
    if (dirty.stdout.trim().length > 0) {
      throw new SpecError(`O worktree da tarefa "${task}" tem alterações não commitadas`, {
        code: 'worktree_dirty',
      });
    }

    const ahead = await runGit(['log', `${entry.baseSha}..${entry.branch}`, '--oneline'], projectRoot);
    if (ahead.stdout.trim().length === 0) {
      throw new SpecError(`A branch da tarefa "${task}" não tem nenhum commit à frente de onde começou`, {
        code: 'worktree_no_changes',
      });
    }

    await writeRegistry(projectRoot, changeId, { ...entry, status: 'merging' });

    const merge = await runGit(['merge', '--no-ff', '-m', `merge ${entry.branch}`, entry.branch], projectRoot);
    if (!merge.ok) {
      await runGit(['merge', '--abort'], projectRoot);
      await writeRegistry(projectRoot, changeId, { ...entry, status: 'merge_conflict' });
      return { merged: false, conflict: true, path: entry.path, branch: entry.branch };
    }

    return finalizeAfterMerge(projectRoot, changeDirPath, changeId, entry);
  });
}

export async function resumeWorktree(workspace: Workspace, changeId: string, task: string): Promise<FinishResult> {
  const projectRoot = workspace.projectRoot;
  await assertMainWorktree(projectRoot);
  const changeDirPath = changeDir(workspace, changeId);

  return withParallelLock(projectRoot, changeId, async () => {
    // Deliberately not `reconcile`: a merge_conflict entry never self-heals -
    // only a human merging by hand, outside this tool, resolves it.
    const entry = await readRegistry(projectRoot, changeId, task);
    if (!entry) {
      throw new SpecError(`Não há worktree registrado para a tarefa "${task}"`, { code: 'worktree_not_found' });
    }
    if (entry.status !== 'merge_conflict') {
      throw new SpecError(`Nada para retomar — estado atual é "${entry.status}"`, {
        code: 'worktree_invalid_state',
      });
    }

    const ancestor = await runGit(['merge-base', '--is-ancestor', entry.branch, 'HEAD'], projectRoot);
    if (!ancestor.ok) {
      throw new SpecError('O merge ainda não foi concluído na árvore principal', {
        code: 'merge_not_completed',
        fix: `cd na raiz do repositório e rode: git merge --no-ff ${entry.branch}`,
      });
    }

    return finalizeAfterMerge(projectRoot, changeDirPath, changeId, entry);
  });
}

export async function listWorktrees(workspace: Workspace, changeId: string): Promise<WorktreeListResult> {
  const projectRoot = workspace.projectRoot;
  await assertMainWorktree(projectRoot);
  const changeDirPath = changeDir(workspace, changeId);

  const tasks = await listRegisteredTasks(projectRoot, changeId);
  const gitWorktrees = await listGitWorktrees(projectRoot);
  const gitPaths = new Set(gitWorktrees.map((entry) => path.resolve(entry.path)));

  const worktrees: WorktreeListEntry[] = [];
  for (const task of tasks) {
    const entry = await withParallelLock(projectRoot, changeId, () =>
      reconcile(projectRoot, changeDirPath, changeId, task)
    );
    if (!entry) continue;
    worktrees.push({
      task: entry.task,
      branch: entry.branch,
      path: entry.path,
      status: entry.status,
      existsOnDisk: gitPaths.has(path.resolve(entry.path)),
    });
  }

  const registeredPaths = new Set(worktrees.map((entry) => path.resolve(entry.path)));
  const conventionRoot = path.resolve(projectRoot, '.specwright', 'worktrees', changeId) + path.sep;
  const unregistered = gitWorktrees
    .filter((entry) => path.resolve(entry.path).startsWith(conventionRoot))
    .filter((entry) => !registeredPaths.has(path.resolve(entry.path)))
    .map((entry) => ({ path: entry.path, branch: entry.branch }));

  return { worktrees, unregistered };
}

export async function cleanupWorktree(
  workspace: Workspace,
  changeId: string,
  options: CleanupOptions = {}
): Promise<CleanupResult> {
  const projectRoot = workspace.projectRoot;
  await assertMainWorktree(projectRoot);
  const changeDirPath = changeDir(workspace, changeId);

  return withParallelLock(projectRoot, changeId, async () => {
    const tasks = options.task ? [options.task] : await listRegisteredTasks(projectRoot, changeId);
    const removed: string[] = [];
    const skipped: { task: string; reason: string }[] = [];

    for (const task of tasks) {
      const entry = await reconcile(projectRoot, changeDirPath, changeId, task);

      if (!entry) {
        // No registry entry - only worth touching if `--force` is explicit and
        // a worktree still sits at the conventional path (registry lost, disk
        // not cleaned up). Never adopted or removed silently otherwise.
        if (options.force) {
          const conventionalPath = worktreePath(projectRoot, changeId, task);
          if (await pathExists(conventionalPath)) {
            await runGit(['worktree', 'remove', '--force', conventionalPath], projectRoot);
            await runGit(['branch', '-D', branchName(changeId, task)], projectRoot);
            removed.push(task);
          }
        }
        continue;
      }

      if (!options.force) {
        const merged = await runGit(['branch', '--merged', 'HEAD'], projectRoot);
        const mergedBranches = merged.stdout.split('\n').map((line) => line.replace(/^\*?\s+/, '').trim());
        if (!mergedBranches.includes(entry.branch)) {
          skipped.push({ task, reason: 'not_merged' });
          continue;
        }
      }

      await runGit(['worktree', 'remove', ...(options.force ? ['--force'] : []), entry.path], projectRoot);
      await runGit(['branch', options.force ? '-D' : '-d', entry.branch], projectRoot);
      await deleteRegistry(projectRoot, changeId, task);
      removed.push(task);
    }

    return { removed, skipped };
  });
}
