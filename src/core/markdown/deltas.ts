import { flattenSections, normalizeLineEndings, parseSections } from './sections.js';
import { parseRequirements, type Requirement } from './requirements.js';

export type DeltaOperation = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';

export interface Rename {
  from: string;
  to: string;
}

export interface DeltaEntry {
  /** Capability path the delta targets, relative to `specs/`, POSIX-separated. */
  capability: string;
  operation: DeltaOperation;
  requirement?: Requirement;
  rename?: Rename;
  /** One-line summary used by `show` and by validation messages. */
  description: string;
}

export interface ParsedDeltaSpec {
  capability: string;
  purpose?: string;
  entries: DeltaEntry[];
  /** Delta section headers that were present, in document order. */
  sections: DeltaOperation[];
}

const OPERATIONS: DeltaOperation[] = ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED'];
const RENAME_FROM = /^\s*-?\s*FROM:\s*`?(?:###\s*)?Requirement:\s*(.+?)`?\s*$/i;
const RENAME_TO = /^\s*-?\s*TO:\s*`?(?:###\s*)?Requirement:\s*(.+?)`?\s*$/i;

export function parseDeltaSpec(capability: string, content: string): ParsedDeltaSpec {
  const sections = flattenSections(parseSections(content));
  const purpose = sections
    .find((section) => section.level === 2 && /^purpose$/i.test(section.title.trim()))
    ?.content.trim();

  const entries: DeltaEntry[] = [];
  const present: DeltaOperation[] = [];

  for (const section of sections.filter((entry) => entry.level === 2)) {
    const operation = OPERATIONS.find((candidate) =>
      new RegExp(`^${candidate}\\s+Requirements$`, 'i').test(section.title.trim())
    );
    if (!operation) continue;
    present.push(operation);

    if (operation === 'RENAMED') {
      for (const rename of parseRenames(section.content)) {
        entries.push({
          capability,
          operation,
          rename,
          description: `Rename requirement "${rename.from}" to "${rename.to}"`,
        });
      }
      continue;
    }

    for (const requirement of parseRequirements(section, content)) {
      entries.push({
        capability,
        operation,
        requirement,
        description: `${verb(operation)} requirement: ${requirement.name}`,
      });
    }
  }

  return { capability, purpose, entries, sections: present };
}

function verb(operation: DeltaOperation): string {
  return operation === 'ADDED' ? 'Add' : operation === 'MODIFIED' ? 'Modify' : 'Remove';
}

export function parseRenames(content: string): Rename[] {
  const renames: Rename[] = [];
  let from: string | undefined;

  for (const line of normalizeLineEndings(content).split('\n')) {
    const fromMatch = RENAME_FROM.exec(line);
    if (fromMatch) {
      from = fromMatch[1].trim();
      continue;
    }
    const toMatch = RENAME_TO.exec(line);
    if (toMatch && from) {
      renames.push({ from, to: toMatch[1].trim() });
      from = undefined;
    }
  }

  return renames;
}

/** Reads the **Reason** / **Migration** lines a REMOVED requirement must carry. */
export function removalNotes(requirement: Requirement): { reason?: string; migration?: string } {
  const read = (label: string): string | undefined =>
    new RegExp(`^\\s*\\*\\*${label}\\*\\*\\s*:\\s*(.+)$`, 'im').exec(requirement.raw)?.[1].trim();
  return { reason: read('Reason'), migration: read('Migration') };
}
