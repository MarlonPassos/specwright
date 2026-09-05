import path from 'node:path';
import { runGit } from '../change/worktree.js';

export interface VersioningReport {
  /** False when the workspace is not a git repository at all. */
  repository: boolean;
  /**
   * True when git has never tracked a single file of this change. The work
   * exists only in this working tree.
   */
  neverVersioned: boolean;
}

/**
 * Whether the work being archived ever reached version control.
 *
 * The change cycle ends in `archive`, which is a `mv` on the filesystem. Nothing
 * checked that the result had ever reached git — and in the project that
 * motivated this, seven of twenty-four archived changes, an entire milestone,
 * existed only as untracked files. A `git clone` brought neither the Makefile,
 * nor the consolidated README, nor the end-to-end test: exactly the artefacts
 * whose reason to exist is letting someone else reproduce the delivery. One of
 * the seven was the "delivery readiness" change itself.
 *
 * The question is asked of the ACTIVE path, before the move, and it is
 * deliberately the weakest useful one: "does git track anything here at all?".
 * Asking it of the archive path instead would fire on every single archive —
 * a rename always leaves the destination untracked until someone commits, which
 * is normal and says nothing. Asking whether the change is fully committed
 * would fire on any work in progress. Neither is the failure worth a warning.
 * "Never versioned" is.
 *
 * A WARNING, never a gate, for the reason `archive.ts` already states about the
 * plan: archiving must never fail because of state downstream of the work. Git
 * is downstream too — committing is the person's call and their moment.
 *
 * Fail-soft throughout: no git, no repository, or a git that errors all read as
 * "nothing to say", never as a problem with the archive.
 */
export async function reportUnversionedWork(
  projectRoot: string,
  activeDir: string
): Promise<VersioningReport> {
  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], projectRoot);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return { repository: false, neverVersioned: false };
  }

  const relative = path.relative(projectRoot, activeDir).replace(/\\/g, '/');
  const tracked = await runGit(['ls-files', '--', relative], projectRoot);
  if (!tracked.ok) return { repository: true, neverVersioned: false };

  return { repository: true, neverVersioned: tracked.stdout.trim() === '' };
}
