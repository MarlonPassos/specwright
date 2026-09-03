import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

/**
 * Debounce window. Measured, not guessed: one logical mutation of a plan emits
 * four `fs.watch` events on macOS —
 *
 *     rename  demo/.plan.yaml.40580.1b5fb35be8f8.tmp
 *     rename  demo/plan.yaml
 *     rename  demo/plan.yaml          (FSEvents repeats it)
 *     rename  demo/.plan.lock
 *
 * — because `writeFileAtomic` and `withStaging` write to a temporary and rename
 * over the target. Recomputing per event would push the reader four frames,
 * including the instant between the two renames where the file does not exist.
 */
const DEBOUNCE_MS = 150;

/** Churn of an in-flight write, never a state the reader should see. */
function isNoise(relativePath: string): boolean {
  const base = path.basename(relativePath);
  return (
    base.endsWith('.tmp') ||
    base === '.plan.lock' ||
    base === '.DS_Store' ||
    relativePath.includes('.staging-')
  );
}

export interface WatchProjectOptions {
  /** Directories to observe. Missing ones are skipped, not an error. */
  directories: string[];
  /** Called once per settled burst. */
  onChange: () => void;
  debounceMs?: number;
}

export interface ProjectWatcher {
  close(): void;
  /** Directories actually being watched. */
  watching: string[];
}

/**
 * Watches the project for changes worth a repaint.
 *
 * Fail-soft: a directory that does not exist yet is skipped rather than
 * throwing, because `planning/` appears only when a plan is created — the server
 * must start in a project that has no plan.
 */
export function watchProject(options: WatchProjectOptions): ProjectWatcher {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const watchers: FSWatcher[] = [];
  const watching: string[] = [];
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const settle = (): void => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!closed) options.onChange();
    }, debounceMs);
    timer.unref?.();
  };

  for (const directory of options.directories) {
    try {
      // macOS emits an extra event naming the WATCHED DIRECTORY itself on every
      // write inside it, carrying no clue about which file moved. Left in, it
      // defeats the noise filter: writing only a `.tmp` still repaints. A real
      // change always also emits a named event, so dropping the self-event
      // loses nothing.
      const self = path.basename(directory);
      const watcher = watch(directory, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const name = filename.toString();
        if (name === self || isNoise(name)) return;
        settle();
      });
      watcher.on('error', () => {
        /* a directory removed under us stops being watched; not fatal */
      });
      watchers.push(watcher);
      watching.push(directory);
    } catch {
      /* absent or unreadable: nothing to observe here */
    }
  }

  return {
    watching,
    close(): void {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
  };
}
