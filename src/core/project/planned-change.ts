import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import {
  findSection,
  headerLines,
  normalizeLineEndings,
  parseSections,
  type MarkdownSection,
} from '../markdown/sections.js';
import { CHANGE_ID_PATTERN, PLANNED_CHANGE_SCHEMA_VERSION, type SourceRef } from './model.js';

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

/** The headings that must be present and non-empty in every Planned Change. */
export const REQUIRED_PLANNED_CHANGE_SECTIONS = ['Objetivo', 'Escopo', 'Critérios macro'] as const;

/**
 * The headings a Planned Change must carry, given whether its plan was built
 * from source documents.
 *
 * `Referências da fonte` used to be merely recommended, so a brief that cited
 * nothing produced a WARNING — which, without `--strict`, reprova nothing. A
 * plan WITH a source document and a brief WITHOUT a pointer back to it has no
 * traceability at all, and that gap is not a matter of taste: nobody can check
 * the scope against anything. When the plan declares no source document there
 * is nothing to point at, and the rule stays exactly as it was — a plan built
 * from conversation alone sees no new error.
 */
export function requiredPlannedChangeSections(
  hasSourceDocuments: boolean
): readonly (typeof PLANNED_CHANGE_SECTIONS)[number][] {
  return hasSourceDocuments
    ? [...REQUIRED_PLANNED_CHANGE_SECTIONS, 'Referências da fonte']
    : [...REQUIRED_PLANNED_CHANGE_SECTIONS];
}

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

const SOURCE_REF_LINE = /^[-*]\s+(.+?)\s*$/;
/** `· divergente`, `(divergente)` or `[divergente]` on a reference line. */
const DIVERGENT_MARKER = /\s*(?:·\s*divergente|\(\s*divergente\s*\)|\[\s*divergente\s*\])/i;

/**
 * Reads `# Referências da fonte` into structured pointers.
 *
 * The section is prose written by a human or an agent, so this parser is
 * deliberately forgiving: it takes list items only, strips Markdown emphasis
 * and backticks, and splits a trailing `:<lines>` off the path when one is
 * there. A line it cannot read at all is skipped rather than failing the
 * parse — losing one pointer must never make a brief unloadable.
 */
export function parseSourceRefs(sections: MarkdownSection[]): SourceRef[] {
  const section = findSection(sections, 'Referências da fonte');
  if (section === undefined) return [];

  const refs: SourceRef[] = [];
  const seen = new Set<string>();
  for (const raw of section.content.split('\n')) {
    const match = SOURCE_REF_LINE.exec(raw.trim());
    if (!match) continue;
    let text = match[1].replace(/`/g, '').replace(/\*\*/g, '').trim();
    if (text.length === 0) continue;
    // `· divergente` marks a reference this increment knowingly departs from.
    const supersedes = DIVERGENT_MARKER.test(text);
    text = text.replace(DIVERGENT_MARKER, '').trim();
    // A trailing parenthetical or em-dash comment is commentary, not path.
    text = text.split(/\s+[—–]\s+/)[0].trim();

    let path = text;
    let lines: string | undefined;
    // `path:371-573` / `path:371`. A Windows drive letter (`C:`) is not a
    // line range, so only a colon followed by a digit or `§` splits.
    const split = /^(.*?):([0-9§][^\s:]*)$/.exec(text);
    if (split) {
      path = split[1].trim();
      lines = split[2].trim();
    }
    if (path.length === 0) continue;
    const key = `${path}::${lines ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({
      path,
      ...(lines !== undefined ? { lines } : {}),
      ...(supersedes ? { supersedes: true as const } : {}),
    });
  }
  return refs;
}

/** Reads the source pointers straight out of a Planned Change document. */
export function sourceRefsOf(text: string): SourceRef[] {
  return parseSourceRefs(parsePlannedChange(text).sections);
}

/**
 * True when the section exists and carries something other than a comment.
 *
 * Markdown comments are the template's own guidance to whoever fills the
 * section in — the §7.5 skeleton uses them to say what shape a scope bullet or
 * a source pointer takes. Counting them as content would make the deliberately
 * invalid skeleton read as complete, which is exactly backwards: the skeleton
 * has to fail validation so the increment stays blocked until someone supplies
 * real prose (R-01, FR-22).
 *
 * It also closes the reverse hole, which existed before any guidance did: a
 * brief whose `# Escopo` held nothing but `<!-- TODO -->` passed as filled.
 */
export function sectionHasText(sections: MarkdownSection[], title: string): boolean {
  const section = findSection(sections, title);
  if (section === undefined) return false;
  return stripComments(section.content).trim().length > 0;
}

/** Removes `<!-- … -->` blocks, including unterminated ones. */
function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
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
/**
 * The one-line hint an empty section carries in the §7.5 skeleton.
 *
 * Only for sections whose SHAPE is not obvious from the heading, and only where
 * getting the shape wrong has a known cost: a scope bullet with no pointer back
 * to the source is a bullet nobody can check, and that is how "dados do cliente"
 * disappeared from one. The comment is a Markdown comment, so it does not count
 * as content — the section stays empty for validation, on purpose.
 */
function guidanceFor(heading: (typeof PLANNED_CHANGE_SECTIONS)[number]): string {
  switch (heading) {
    case 'Escopo':
      return '<!-- Um bullet por entrega, cada um com a origem: - entrega  [fonte: §N / linhas] -->';
    case 'Critérios macro':
      return '<!-- Um critério por linha, cada um conferível: - critério → como se verifica -->';
    case 'Referências da fonte':
      return [
        '<!-- Um ponteiro por linha: - caminho/do/documento.md:linha-inicial-linha-final',
        '     Acrescente `· divergente` ao ponteiro do qual este incremento se afasta de',
        '     propósito; o design explica o quê, por quê e o que se perde. -->',
      ].join('\n');
    default:
      return '';
  }
}

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
    const content =
      heading === 'Objetivo' ? objetivo : (provided[heading]?.trim() ?? guidanceFor(heading));
    if (content) {
      lines.push(content, '');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
