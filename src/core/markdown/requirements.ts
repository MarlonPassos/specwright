import {
  flattenSections,
  normalizeLineEndings,
  parseSections,
  type MarkdownSection,
} from './sections.js';

export interface Scenario {
  name: string;
  text: string;
  line: number;
}

export interface Requirement {
  name: string;
  /** Requirement prose, excluding its scenarios. */
  text: string;
  scenarios: Scenario[];
  /** The requirement header line, 1-based. */
  line: number;
  /** The whole block, header through last scenario, as authored. */
  raw: string;
}

const REQUIREMENT_TITLE = /^Requirement:\s*(.+)$/i;
const SCENARIO_TITLE = /^Scenario:\s*(.+)$/i;

export function isRequirementHeader(title: string): boolean {
  return REQUIREMENT_TITLE.test(title.trim());
}

export function requirementName(title: string): string | undefined {
  return REQUIREMENT_TITLE.exec(title.trim())?.[1].trim();
}

/**
 * Reads the `### Requirement:` blocks directly under `section`.
 *
 * Headers that are not requirement headers are skipped rather than treated as
 * scenario-less requirements: delta sections often carry divider headers, and
 * counting one as a requirement invents a requirement nobody wrote.
 */
export function parseRequirements(section: MarkdownSection, source: string): Requirement[] {
  const lines = normalizeLineEndings(source).split('\n');

  return section.children
    .filter((child) => isRequirementHeader(child.title))
    .map((child) => {
      const scenarios = child.children
        .filter((grandchild) => SCENARIO_TITLE.test(grandchild.title.trim()))
        .map((grandchild) => ({
          name: SCENARIO_TITLE.exec(grandchild.title.trim())![1].trim(),
          text: grandchild.content.trim(),
          line: grandchild.line,
        }));

      const firstScenarioLine = child.children.find((grandchild) =>
        SCENARIO_TITLE.test(grandchild.title.trim())
      )?.line;
      const prose = firstScenarioLine
        ? lines.slice(child.line, firstScenarioLine - 1).join('\n').trim()
        : child.content.trim();

      return {
        name: requirementName(child.title)!,
        text: prose,
        scenarios,
        line: child.line,
        raw: extractBlock(lines, child),
      };
    });
}

/** The authored text of a section, header line included. */
export function extractBlock(lines: string[], section: MarkdownSection): string {
  const start = section.line - 1;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+\S/.exec(lines[index]);
    if (match && match[1].length <= section.level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').replace(/\s+$/, '');
}

export interface MainSpec {
  name: string;
  purpose: string;
  requirements: Requirement[];
}

/**
 * Parses a main spec: a `## Purpose` section and the requirements listed under
 * `## Requirements`.
 */
export function parseMainSpec(name: string, content: string): MainSpec {
  // Flattened, so a spec that opens with an `# H1` title keeps its `##`
  // sections visible: under an H1 they are children rather than roots.
  const sections = flattenSections(parseSections(content));
  const purpose = sections.find(
    (section) => section.level === 2 && /^purpose$/i.test(section.title.trim())
  );
  const requirementsSection = sections.find(
    (section) => section.level === 2 && /^requirements$/i.test(section.title.trim())
  );

  return {
    name,
    purpose: purpose?.content.trim() ?? '',
    requirements: requirementsSection ? parseRequirements(requirementsSection, content) : [],
  };
}
