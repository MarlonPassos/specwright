import { SpecError } from '../../util/errors.js';
import { headerLines, normalizeLineEndings } from '../markdown/sections.js';
import { purposePlaceholder } from '../validate/rules.js';
import type { DeltaEntry } from '../markdown/deltas.js';

export interface RequirementBlock {
  name: string;
  /** The block as authored: header line through the line before the next block. */
  raw: string;
}

export interface SpecParts {
  /** Everything up to and including the `## Requirements` header. */
  head: string[];
  /** Text between that header and the first requirement. */
  preamble: string[];
  blocks: RequirementBlock[];
  /** Everything from the next level-2 header onwards. */
  tail: string[];
}

const REQUIREMENTS_HEADER = /^requirements$/i;
const REQUIREMENT_TITLE = /^Requirement:\s*(.+)$/i;

/**
 * Splits a main spec into the parts a merge needs: the text around the
 * requirements section, and the requirement blocks inside it. Everything
 * outside the blocks is carried through untouched, so a merge never rewrites
 * prose it does not own.
 */
export function splitSpec(content: string): SpecParts {
  const lines = normalizeLineEndings(content).split('\n');
  const headers = headerLines(content);

  const requirementsHeader = headers.find(
    (header) => header.level === 2 && REQUIREMENTS_HEADER.test(header.title)
  );
  if (!requirementsHeader) {
    throw new SpecError('Spec has no "## Requirements" section to merge into', {
      code: 'spec_missing_requirements',
    });
  }

  const next = headers.find(
    (header) => header.level === 2 && header.line > requirementsHeader.line
  );
  const sectionStart = requirementsHeader.line; // 0-based index of the line after the header
  const sectionEnd = next ? next.line - 1 : lines.length;

  const requirementHeaders = headers.filter(
    (header) =>
      header.level === 3 &&
      header.line > requirementsHeader.line &&
      header.line <= sectionEnd &&
      REQUIREMENT_TITLE.test(header.title)
  );

  const firstRequirementLine = requirementHeaders[0]?.line;
  const preambleEnd = firstRequirementLine ? firstRequirementLine - 1 : sectionEnd;

  const blocks: RequirementBlock[] = requirementHeaders.map((header, index) => {
    const start = header.line - 1;
    const end = requirementHeaders[index + 1] ? requirementHeaders[index + 1].line - 1 : sectionEnd;
    return {
      name: REQUIREMENT_TITLE.exec(header.title)![1].trim(),
      raw: lines.slice(start, end).join('\n').replace(/\s+$/, ''),
    };
  });

  return {
    head: lines.slice(0, sectionStart),
    preamble: lines.slice(sectionStart, preambleEnd),
    blocks,
    tail: lines.slice(sectionEnd),
  };
}

export function joinSpec(parts: SpecParts): string {
  const body = parts.blocks.map((block) => block.raw.trim()).join('\n\n');
  const preamble = parts.preamble.join('\n').trim();

  const segments = [parts.head.join('\n').replace(/\s+$/, '')];
  if (preamble) segments.push(preamble);
  if (body) segments.push(body);

  const tail = parts.tail.join('\n').trim();
  let content = segments.join('\n\n');
  if (tail) content += `\n\n${tail}`;
  return `${content.replace(/\s+$/, '')}\n`;
}

export function specSkeleton(capability: string, purpose: string): string {
  const title = capability
    .split('/')
    .pop()!
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return [`# ${title} Specification`, '', '## Purpose', '', purpose.trim(), '', '## Requirements', ''].join(
    '\n'
  );
}

export interface MergeResult {
  content: string;
  applied: string[];
  /** Capability retired: the merge left the spec with no requirements. */
  empty: boolean;
}

/**
 * Folds one capability's delta entries into its main spec.
 *
 * `existing` is undefined for a capability the change introduces; the merge
 * then builds the spec around the delta's Purpose, or around a placeholder when
 * the delta did not supply one.
 */
export function mergeCapability(
  capability: string,
  entries: DeltaEntry[],
  options: { existing?: string; purpose?: string; changeId: string }
): MergeResult {
  const base =
    options.existing ??
    specSkeleton(capability, options.purpose?.trim() || purposePlaceholder(options.changeId));

  const parts = splitSpec(base);
  const applied: string[] = [];

  for (const entry of entries) {
    switch (entry.operation) {
      case 'ADDED': {
        const requirement = entry.requirement!;
        const index = indexOfBlock(parts.blocks, requirement.name);
        // An ADDED requirement whose name is already present overwrites it
        // rather than creating a duplicate: two blocks with one name make every
        // later lookup ambiguous.
        if (index >= 0) parts.blocks[index] = { name: requirement.name, raw: requirement.raw };
        else parts.blocks.push({ name: requirement.name, raw: requirement.raw });
        applied.push(`ADDED ${requirement.name}`);
        break;
      }
      case 'MODIFIED': {
        const requirement = entry.requirement!;
        const index = requireBlock(parts.blocks, requirement.name, capability, 'MODIFIED');
        parts.blocks[index] = { name: requirement.name, raw: requirement.raw };
        applied.push(`MODIFIED ${requirement.name}`);
        break;
      }
      case 'REMOVED': {
        const requirement = entry.requirement!;
        const index = requireBlock(parts.blocks, requirement.name, capability, 'REMOVED');
        parts.blocks.splice(index, 1);
        applied.push(`REMOVED ${requirement.name}`);
        break;
      }
      case 'RENAMED': {
        const { from, to } = entry.rename!;
        const index = requireBlock(parts.blocks, from, capability, 'RENAMED');
        const block = parts.blocks[index];
        parts.blocks[index] = {
          name: to,
          raw: block.raw.replace(/^###\s+Requirement:.*$/m, `### Requirement: ${to}`),
        };
        applied.push(`RENAMED ${from} -> ${to}`);
        break;
      }
    }
  }

  return { content: joinSpec(parts), applied, empty: parts.blocks.length === 0 };
}

function indexOfBlock(blocks: RequirementBlock[], name: string): number {
  const wanted = normalizeName(name);
  return blocks.findIndex((block) => normalizeName(block.name) === wanted);
}

function requireBlock(
  blocks: RequirementBlock[],
  name: string,
  capability: string,
  operation: string
): number {
  const index = indexOfBlock(blocks, name);
  if (index < 0) {
    throw new SpecError(
      `${operation} targets requirement "${name}", which spec "${capability}" does not declare`,
      { code: 'requirement_not_found', fix: `specs show ${capability} --type spec` }
    );
  }
  return index;
}

/** Header text is compared whitespace-insensitively, as the delta guidance promises. */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
