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
 * each source, in the order the sources are declared in `source_documents`. A
 * missing source contributes an empty string, so the hash still changes if a
 * file is later added or removed.
 *
 * Each content is FRAMED by its byte length before being absorbed. A plain
 * `join('\n')` let the boundary between two documents dissolve into the
 * contents themselves: one source holding `a\nb` produced the same digest as
 * two sources holding `a` and `b`, so splitting or merging source documents
 * changed the set without changing the hash and every brief stayed `current`
 * on evidence that no longer described the same inputs (R-03).
 *
 * The frame carries only a length, never a path, so the digest stays
 * independent of where the sources live on disk.
 */
export function sourceHash(sources: HashableSource[]): string {
  const digest = createHash('sha256');
  for (const source of sources) {
    const content = normalize(source.content ?? '');
    digest.update(`${Buffer.byteLength(content, 'utf8')}\n`, 'utf8');
    digest.update(content, 'utf8');
  }
  return digest.digest('hex');
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
