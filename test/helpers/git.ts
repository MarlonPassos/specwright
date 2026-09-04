import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeWorkspace } from './workspace.js';
import type { Workspace } from '../../src/core/workspace.js';

const execFileAsync = promisify(execFile);

export async function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd });
}

export async function initGitRepo(dir: string): Promise<void> {
  await git(['init', '-q', '-b', 'main'], dir);
  await git(['config', 'user.email', 'test@example.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
  await git(['config', 'commit.gpgsign', 'false'], dir);
}

export async function commitAll(dir: string, message: string): Promise<void> {
  await git(['add', '-A'], dir);
  await git(['commit', '-q', '-m', message], dir);
}

/** A temp project with an initialised workspace AND a git repo whose HEAD carries everything written so far. */
export async function makeGitWorkspace(options: { harnesses?: string } = {}): Promise<Workspace> {
  const workspace = await makeWorkspace(options);
  await initGitRepo(workspace.projectRoot);
  await commitAll(workspace.projectRoot, 'initial');
  return workspace;
}
