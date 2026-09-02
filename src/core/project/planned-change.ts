import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import {
  findSection,
  headerLines,
  normalizeLineEndings,
  parseSections,
  type MarkdownSection,
} from '../markdown/sections.js';
import { CHANGE_ID_PATTERN, PLANNED_CHANGE_SCHEMA_VERSION } from './model.js';

const KEBAB_CASE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export const PlannedChangeFrontmatterSchema = z
  .object({
    schema_version: z.literal(PLANNED_CHANGE_SCHEMA_VERSION),
    id: z.string().regex(CHANGE_ID_PATTERN),
    slug: z.string().regex(KEBAB_CASE),
    title: z.string().min(1),
    plan_revision: z.number().int().nonnegative(),
  })
  .strict();
export type PlannedChangeFrontmatter = z.infer<typeof PlannedChangeFrontmatterSchema>;

/** Headings a Planned Change carries, in canonical order. */
export const PLANNED_CHANGE_SECTIONS = [
  'Objetivo',
  'Motivação',
  'Escopo',
  'Fora do escopo',
  'Critérios macro',
  'Riscos',
  'Notas para exploração',
  'Referências da fonte',
  'Readiness e handoff',
] as const;

/** The three headings that must be present and non-empty. */
export const REQUIRED_PLANNED_CHANGE_SECTIONS = ['Objetivo', 'Escopo', 'Critérios macro'] as const;

/** `## ADDED Requirements` and friends must never appear in a Planned Change. */
export const DELTA_HEADER_PATTERN = /^(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements$/i;

export interface ParsedPlannedChange {
  /** Present only when the frontmatter block exists and parses against the schema. */
  frontmatter?: PlannedChangeFrontmatter;
  /** A human-readable reason the frontmatter is unusable, when it is. */
  frontmatterError?: string;
  /** The Markdown after the frontmatter block (or the whole text when there is none). */
  body: string;
  sections: MarkdownSection[];
  /** Headings whose title matches a delta header. */
  deltaHeaders: string[];
}

/** Splits a leading `--- … ---` frontmatter block from the body. */
export function splitFrontmatter(text: string): { frontmatter?: string; body: string } {
  const normalized = normalizeLineEndings(text);
  if (!normalized.startsWith('---\n') && normalized !== '---') {
    return { body: normalized };
  }
  const rest = normalized.slice(4);
  const end = rest.indexOf('\n---');
  if (end === -1) {
    return { body: normalized };
  }
  const frontmatter = rest.slice(0, end);
  const body = rest.slice(end + 4).replace(/^\n+/, '');
  return { frontmatter, body };
}

export function parsePlannedChange(text: string): ParsedPlannedChange {
  const { frontmatter, body } = splitFrontmatter(text);
  const sections = parseSections(body);
  const deltaHeaders = headerLines(body)
    .filter((header) => DELTA_HEADER_PATTERN.test(header.title))
    .map((header) => header.title);

  if (frontmatter === undefined) {
    return { frontmatterError: 'frontmatter ausente', body, sections, deltaHeaders };
  }

  let raw: unknown;
  try {
    raw = parseYaml(frontmatter);
  } catch (error) {
    return {
      frontmatterError: `frontmatter não é YAML válido: ${(error as Error).message}`,
      body,
      sections,
      deltaHeaders,
    };
  }

  const result = PlannedChangeFrontmatterSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { frontmatterError: `frontmatter inválido: ${detail}`, body, sections, deltaHeaders };
  }

  return { frontmatter: result.data, body, sections, deltaHeaders };
}

/** True when the section exists and has non-whitespace content. */
export function sectionHasText(sections: MarkdownSection[], title: string): boolean {
  const section = findSection(sections, title);
  return section !== undefined && section.content.trim().length > 0;
}

export interface RenderPlannedChangeInput {
  id: string;
  slug: string;
  title: string;
  planRevision: number;
  /** Section body by heading. Missing headings are emitted empty. */
  sections?: Partial<Record<(typeof PLANNED_CHANGE_SECTIONS)[number], string>>;
}

/**
 * Renders a Planned Change document. With no `sections` this is the honest
 * skeleton of §7.5: `Objetivo` names the increment, everything else is empty,
 * and the result fails validation on purpose so the gap is visible.
 */
export function renderPlannedChange(input: RenderPlannedChangeInput): string {
  const provided = input.sections ?? {};
  const objetivo =
    provided.Objetivo?.trim() ||
    `Incremento "${input.title}". Descreva aqui o resultado que este incremento entrega.`;

  // Serialised, never concatenated: a title carrying `:` — "Fundação: empacotamento"
  // is the natural way to write one — produced frontmatter that no longer parsed
  // as YAML, and the increment was rejected as invalid at write time.
  const frontmatter = stringifyYaml({
    schema_version: PLANNED_CHANGE_SCHEMA_VERSION,
    id: input.id,
    slug: input.slug,
    title: input.title,
    plan_revision: input.planRevision,
  }).trimEnd();

  const lines: string[] = ['---', frontmatter, '---', ''];

  for (const heading of PLANNED_CHANGE_SECTIONS) {
    lines.push(`# ${heading}`, '');
    const content = heading === 'Objetivo' ? objetivo : provided[heading]?.trim() ?? '';
    if (content) {
      lines.push(content, '');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
