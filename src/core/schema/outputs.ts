import path from 'node:path';
import { promises as fs } from 'node:fs';

/**
 * Turns a schema `generates` pattern into a matcher over POSIX-separated paths
 * relative to the change directory.
 *
 * Only the two forms schemas actually use are supported: `*` matches within one
 * path segment, `**` spans segments. Anything else is literal.
 */
export function matchesOutputPattern(pattern: string, relativePath: string): boolean {
  return outputPatternRegex(pattern).test(toPosix(relativePath));
}

function outputPatternRegex(pattern: string): RegExp {
  const posix = toPosix(pattern);
  let source = '';

  for (let index = 0; index < posix.length; index += 1) {
    const character = posix[index];
    if (character === '*') {
      const isDoubleStar = posix[index + 1] === '*';
      if (isDoubleStar) {
        const skipsSeparator = posix[index + 2] === '/';
        source += skipsSeparator ? '(?:.*/)?' : '.*';
        index += skipsSeparator ? 2 : 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`^${source}$`);
}

export function isPattern(generates: string): boolean {
  return generates.includes('*');
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/').replace(/\\/g, '/');
}

/**
 * Files inside `changeDir` that an artifact's `generates` entry produces,
 * relative to the change directory and POSIX-separated.
 */
export async function resolveOutputs(changeDir: string, generates: string): Promise<string[]> {
  if (!isPattern(generates)) {
    const absolute = path.join(changeDir, generates);
    try {
      return (await fs.stat(absolute)).isFile() ? [toPosix(generates)] : [];
    } catch {
      return [];
    }
  }

  const matcher = outputPatternRegex(generates);
  const matches: string[] = [];

  const walk = async (dir: string, relative: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), next);
      } else if (entry.isFile() && matcher.test(next)) {
        matches.push(next);
      }
    }
  };

  await walk(changeDir, '');
  return matches;
}

export async function outputExists(changeDir: string, generates: string): Promise<boolean> {
  return (await resolveOutputs(changeDir, generates)).length > 0;
}
