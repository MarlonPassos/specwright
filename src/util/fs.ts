import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

export async function writeFileEnsured(target: string, content: string): Promise<void> {
  await ensureDir(path.dirname(target));
  await fs.writeFile(target, content, 'utf8');
}

export async function readFileIfExists(target: string): Promise<string | undefined> {
  try {
    return await fs.readFile(target, 'utf8');
  } catch {
    return undefined;
  }
}

export async function listDirectories(target: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Writes `content` through a temporary file in the SAME directory, then renames
 * it onto `target`. `fs.rename` is atomic within one filesystem, so a reader
 * never sees a half-written file and a crash leaves either the old bytes or the
 * new ones, never a truncated mix.
 */
export async function writeFileAtomic(target: string, content: string): Promise<void> {
  await ensureDir(path.dirname(target));
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  );
  try {
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Staging for a multi-file mutation, with rollback.
 *
 * Everything is written to a sibling temporary directory first. Before the
 * commit, every destination is checked: a destination that is a directory would
 * make `rename` fail halfway, so it is rejected up front. During the commit each
 * existing destination is moved aside into the staging area before being
 * replaced, so a failure on the N-th file restores every destination already
 * moved and the mutation is all-or-nothing. `afterCommit`, when supplied, runs
 * while the backups still exist; if it throws, the same rollback is performed.
 *
 * `remove` deletes as part of the same transaction: the destination is MOVED
 * into the staging backup rather than unlinked, so a later failure puts it back.
 * The native archive retires capability specs this way; it used to `fs.rm` them
 * mid-sequence, which was the one irreversible step in the whole flow (F-08,
 * A-05).
 *
 * When a rollback itself cannot complete, the staging directory is deliberately
 * LEFT ON DISK so `specs project validate` can report `partial_write_detected`
 * and the repair is `git restore planning/<plan-id>/`.
 */
export async function withStaging<T>(
  stagingRoot: string,
  run: (
    stage: (relativePath: string, content: string) => void,
    remove: (relativePath: string) => void
  ) => Promise<T>,
  afterCommit?: () => Promise<void>
): Promise<T> {
  const stagingDir = path.join(stagingRoot, `.tmp-${process.pid}-${randomBytes(6).toString('hex')}`);
  const backupDir = path.join(stagingDir, '.backup');
  const pending = new Map<string, string>();
  const removals = new Set<string>();

  const stage = (relativePath: string, content: string): void => {
    removals.delete(relativePath);
    pending.set(relativePath, content);
  };
  const remove = (relativePath: string): void => {
    pending.delete(relativePath);
    removals.add(relativePath);
  };

  let result: T;
  try {
    result = await run(stage, remove);
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }

  // Pre-flight: a destination that is a directory can never be replaced by a
  // rename. Catch it before the first move instead of halfway through.
  for (const relativePath of pending.keys()) {
    const target = path.join(stagingRoot, relativePath);
    const stats = await fs.stat(target).catch(() => undefined);
    if (stats?.isDirectory()) {
      await fs.rm(stagingDir, { recursive: true, force: true });
      throw new Error(
        `Não é possível gravar "${relativePath}": o destino existe e é um diretório.`
      );
    }
  }
  for (const relativePath of removals) {
    const target = path.join(stagingRoot, relativePath);
    const stats = await fs.stat(target).catch(() => undefined);
    if (stats?.isDirectory()) {
      await fs.rm(stagingDir, { recursive: true, force: true });
      throw new Error(
        `Não é possível remover "${relativePath}": o destino é um diretório.`
      );
    }
  }

  try {
    await ensureDir(stagingDir);
    for (const [relativePath, content] of pending) {
      const staged = path.join(stagingDir, relativePath);
      await ensureDir(path.dirname(staged));
      await fs.writeFile(staged, content, 'utf8');
    }
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }

  /** Destinations already replaced or removed, newest first, for rollback. */
  const moved: Array<{ target: string; backup?: string }> = [];

  try {
    for (const relativePath of pending.keys()) {
      const staged = path.join(stagingDir, relativePath);
      const target = path.join(stagingRoot, relativePath);
      await ensureDir(path.dirname(target));

      let backup: string | undefined;
      if (await pathExists(target)) {
        backup = path.join(backupDir, relativePath);
        await ensureDir(path.dirname(backup));
        await fs.rename(target, backup);
      }
      // Record the backup before replacing the destination. If the replacement
      // fails after the old file moved aside, rollback must know how to restore
      // it; recording only after the second rename lost that file on failure.
      moved.unshift({ target, backup });
      await fs.rename(staged, target);
    }
    // Removals last, and by MOVE: a delete is the one step a rollback cannot
    // invent its way out of, so the bytes stay in the staging backup until the
    // whole mutation has committed.
    for (const relativePath of removals) {
      const target = path.join(stagingRoot, relativePath);
      if (!(await pathExists(target))) continue;
      const backup = path.join(backupDir, relativePath);
      await ensureDir(path.dirname(backup));
      await fs.rename(target, backup);
      moved.unshift({ target, backup });
    }
    await afterCommit?.();
  } catch (error) {
    try {
      for (const entry of moved) {
        await fs.rm(entry.target, { force: true });
        if (entry.backup) await fs.rename(entry.backup, entry.target);
      }
      await fs.rm(stagingDir, { recursive: true, force: true });
    } catch {
      // The rollback failed: keep the staging directory so the partial state is
      // detectable and reparable instead of silently disappearing.
    }
    throw error;
  }

  await fs.rm(stagingDir, { recursive: true, force: true });
  return result;
}

/**
 * Collects every file under `root` whose name matches `fileName`, returning
 * paths relative to `root` with POSIX separators so they compare the same on
 * every platform.
 */
export async function findFilesNamed(root: string, fileName: string): Promise<string[]> {
  const found: string[] = [];

  const walk = async (dir: string, relative: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      // A `.`-prefixed directory is never content: it is a staging area
      // (`withStaging`) or tooling state. Walking one would publish a
      // half-committed file as if it were a real spec.
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        await walk(absolute, next);
      } else if (entry.isFile() && entry.name === fileName) {
        found.push(next);
      }
    }
  };

  await walk(root, '');
  return found;
}
