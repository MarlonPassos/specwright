import { createHash } from 'node:crypto';
import { normalizeLineEndings } from '../markdown/sections.js';

/**
 * The only normalization applied before hashing: CRLF and lone CR become LF, so
 * `source_hash` and `content_hash` do not change when a file crosses platforms
 * or is checked out with a different line-ending policy. Nothing else.
 */
export function normalize(content: string): string {
  return normalizeLineEndings(content);
}

export function sha256(content: string): string {
  return createHash('sha256').update(normalize(content), 'utf8').digest('hex');
}

export interface HashableSource {
  path: string;
  /** The current file content, or undefined when the file is missing. */
  content: string | undefined;
}

/**
 * Hash of the source set that backs a Planned Change: the normalized content of
 * each source concatenated in the order the sources are declared in
 * `source_documents`. A missing source contributes an empty string, so the hash
 * still changes if a file is later added or removed.
 */
export function sourceHash(sources: HashableSource[]): string {
  const joined = sources.map((source) => normalize(source.content ?? '')).join('\n');
  return createHash('sha256').update(joined, 'utf8').digest('hex');
}

/** Hash of the exact bytes written to a Planned Change. */
export function contentHash(text: string): string {
  return sha256(text);
}

/**
 * Hash of the record fields that make a brief `outdated` when they change:
 * `slug`, `title`, `depends_on` (order-insensitive) and `milestone`. A change to
 * only `priority` or `manual_blockers` does not move this hash.
 */
export function recordHash(fields: {
  slug: string;
  title: string;
  dependsOn: readonly string[];
  milestone: string | null;
}): string {
  return sha256(
    [
      fields.slug,
      fields.title,
      [...fields.dependsOn].sort().join(','),
      fields.milestone ?? '',
    ].join('\n')
  );
}
