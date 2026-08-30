export interface MarkdownSection {
  level: number;
  title: string;
  /** Text between this header and the next header of the same or lower level. */
  content: string;
  /** First line of the header, 1-based. */
  line: number;
  children: MarkdownSection[];
}

const HEADER = /^(#{1,6})\s+(.*\S)\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

/**
 * Marks the lines that sit inside a fenced code block, including the fence
 * lines themselves. Headers inside a fence are documentation, not structure -
 * every reader in this codebase consults the same mask so they agree on which
 * ones are real.
 */
export function buildFenceMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let fence: string | undefined;

  lines.forEach((line, index) => {
    const match = FENCE.exec(line);
    if (fence === undefined) {
      if (match) {
        fence = match[1][0].repeat(3);
        mask[index] = true;
      }
      return;
    }
    mask[index] = true;
    if (match && match[1].startsWith(fence)) {
      fence = undefined;
    }
  });

  return mask;
}

/** Header lines that are not inside a fenced code block. */
export function headerLines(content: string): Array<{ level: number; title: string; line: number }> {
  const lines = normalizeLineEndings(content).split('\n');
  const mask = buildFenceMask(lines);
  const headers: Array<{ level: number; title: string; line: number }> = [];

  lines.forEach((line, index) => {
    if (mask[index]) return;
    const match = HEADER.exec(line);
    if (match) headers.push({ level: match[1].length, title: match[2].trim(), line: index + 1 });
  });

  return headers;
}

/** Parses a document into a tree of sections, ignoring fenced code blocks. */
export function parseSections(content: string): MarkdownSection[] {
  const lines = normalizeLineEndings(content).split('\n');
  const mask = buildFenceMask(lines);
  const roots: MarkdownSection[] = [];
  const stack: MarkdownSection[] = [];

  lines.forEach((line, index) => {
    if (mask[index]) return;
    const match = HEADER.exec(line);
    if (!match) return;

    const level = match[1].length;
    const section: MarkdownSection = {
      level,
      title: match[2].trim(),
      content: contentUntilNextHeader(lines, mask, index + 1, level),
      line: index + 1,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length === 0) roots.push(section);
    else stack[stack.length - 1].children.push(section);
    stack.push(section);
  });

  return roots;
}

function contentUntilNextHeader(
  lines: string[],
  mask: boolean[],
  start: number,
  level: number
): string {
  const collected: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const match = mask[index] ? null : HEADER.exec(lines[index]);
    if (match && match[1].length <= level) break;
    collected.push(lines[index]);
  }
  return collected.join('\n').trim();
}

/** Every section in the tree, in document order. */
export function flattenSections(sections: MarkdownSection[]): MarkdownSection[] {
  return sections.flatMap((section) => [section, ...flattenSections(section.children)]);
}

/**
 * Finds a section by title anywhere in the tree, case-insensitively.
 *
 * Searching the whole tree rather than the roots is what lets a document open
 * with a `# Title` heading: its `##` sections are then children, not roots, and
 * a roots-only search would report every one of them as missing.
 */
export function findSection(
  sections: MarkdownSection[],
  title: string
): MarkdownSection | undefined {
  const wanted = title.trim().toLowerCase();
  return flattenSections(sections).find(
    (section) => section.title.trim().toLowerCase() === wanted
  );
}
