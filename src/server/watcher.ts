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
  /** Directories actually being watched, right now. */
  readonly watching: string[];
}

/**
 * Watches the project for changes worth a repaint.
 *
 * A directory that does not exist yet is not an error and, more importantly,
 * not a lost cause: `planning/` só aparece quando um plano é criado, e criar um
 * plano é justamente a mudança que o leitor quer ver. Por isso o diretório
 * ausente deixa uma sentinela no PAI — quando ele nasce, o watch recursivo é
 * estabelecido e a criação já conta como mudança.
 *
 * A mesma sentinela cobre um diretório observado que some no meio do caminho
 * (um `git checkout` para um branch sem plano, e a volta): o watch morto é
 * descartado e refeito quando o diretório reaparece.
 */
export function watchProject(options: WatchProjectOptions): ProjectWatcher {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const wanted = [...options.directories];
  /** Diretório desejado -> watch recursivo vivo. */
  const active = new Map<string, FSWatcher>();
  /** Diretório pai -> sentinela, enquanto algum filho desejado estiver ausente. */
  const sentinels = new Map<string, FSWatcher>();
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

  const attach = (directory: string): boolean => {
    if (closed || active.has(directory)) return false;
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
        // O diretório sumiu debaixo do watch. Descartar e voltar a vigiar o pai
        // é o que permite reencontrá-lo; engolir o erro em silêncio deixaria o
        // painel dizendo "ao vivo" sobre um observador morto.
        active.delete(directory);
        watcher.close();
        guardParents();
      });
      active.set(directory, watcher);
      return true;
    } catch {
      return false;
    }
  };

  const missing = (): string[] => wanted.filter((directory) => !active.has(directory));

  /** Vigia o pai de todo diretório ainda ausente, e só enquanto houver algum. */
  const guardParents = (): void => {
    if (closed) return;
    for (const directory of missing()) {
      const parent = path.dirname(directory);
      if (sentinels.has(parent)) continue;
      try {
        const sentinel = watch(parent, { recursive: false }, () => {
          let born = false;
          for (const candidate of missing()) born = attach(candidate) || born;
          if (born) {
            // O diretório nascer JÁ é a mudança: o plano acabou de ser criado.
            settle();
            releaseParents();
          }
        });
        sentinel.on('error', () => {
          sentinel.close();
          sentinels.delete(parent);
        });
        sentinels.set(parent, sentinel);
      } catch {
        /* nem o pai existe: não há onde vigiar */
      }
    }
    releaseParents();
  };

  /** Sentinela sem nenhum filho ausente não tem mais o que esperar. */
  const releaseParents = (): void => {
    const stillWanted = new Set(missing().map((directory) => path.dirname(directory)));
    for (const [parent, sentinel] of sentinels) {
      if (stillWanted.has(parent)) continue;
      sentinel.close();
      sentinels.delete(parent);
    }
  };

  for (const directory of wanted) attach(directory);
  guardParents();

  return {
    get watching(): string[] {
      return [...active.keys()];
    },
    close(): void {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const watcher of active.values()) watcher.close();
      for (const sentinel of sentinels.values()) sentinel.close();
      active.clear();
      sentinels.clear();
    },
  };
}
