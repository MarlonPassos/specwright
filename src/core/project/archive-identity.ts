/**
 * The single authority over the shape of an archive directory name.
 *
 * An archive directory is `<YYYY-MM-DD>-<slug>[-N]`, where `-N` is the
 * collision suffix `specs archive` adds when the same change is archived twice
 * on one day. That format is ambiguous by construction: `2026-01-01-release-2`
 * is either the slug `release-2`, or the slug `release` archived a second time.
 * Every parser that resolved the ambiguity on its own resolved it in favour of
 * the suffix, which silently truncated legitimate slugs (F-07).
 *
 * Two rules live here, and nowhere else:
 * - how candidate directories ORDER (F-01: `(date, numeric suffix)`, never text);
 * - how a directory name maps back to an identity (F-07: by context, never by
 *   a blind `-\d+$` strip).
 */

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches every archive directory name that can answer for `slug`. */
export function archiveNamePattern(slug: string): RegExp {
  return new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escapeRegExp(slug)}(-\\d+)?$`);
}

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})-(.+)$/;
const COLLISION_SUFFIX = /^(.+)-(\d+)$/;

/**
 * Newest first: the date prefix compares as text (it is zero-padded), the `-N`
 * collision suffix compares as a NUMBER. A plain string sort would rank
 * `...-2` above `...-10`, picking the wrong archive.
 *
 * This is the ONLY comparator for archive directories in the repository. Three
 * independent orderings — two of them lexical — used to disagree about which
 * archive is the newest, so `link`, `sync` and `status` could each answer a
 * different directory for the same slug (F-01, A-01).
 */
export function compareArchiveDirs(a: string, b: string): number {
  const split = (name: string): [string, number] => {
    const withoutSuffix = COLLISION_SUFFIX.exec(name);
    return withoutSuffix === null
      ? [name, 1]
      : [withoutSuffix[1], Number(withoutSuffix[2])];
  };
  const [baseA, suffixA] = split(a);
  const [baseB, suffixB] = split(b);
  return baseB.localeCompare(baseA) || suffixB - suffixA || b.localeCompare(a);
}

/** Archive directory names, newest first. */
export function sortArchiveDirs(names: readonly string[]): string[] {
  return [...names].sort(compareArchiveDirs);
}

export interface ArchiveIdentity {
  /** `YYYY-MM-DD`, or `''` when the name carries no date prefix. */
  date: string;
  /** The change name the directory actually stands for. */
  slug: string;
  /** The collision ordinal, when the trailing `-N` really is one. */
  collision?: number;
  /**
   * The name ends in `-N` and nothing in the context says whether that `N`
   * belongs to the slug or is a collision suffix. The caller must refuse to
   * guess rather than pick one.
   */
  ambiguous: boolean;
}

/**
 * Identity of an archive directory. `-N` is read as a collision suffix ONLY
 * when the context proves it: a slug the plan (or the workspace) declares wins
 * over the textual guess.
 *
 * `knownSlugs` should carry everything the caller knows about: the manifest's
 * slugs, the `link.name` of every link, and the names of active changes.
 */
export function parseArchiveIdentity(
  dirName: string,
  knownSlugs: ReadonlySet<string>
): ArchiveIdentity {
  const dated = DATE_PREFIX.exec(dirName);
  const date = dated ? dated[1] : '';
  const rest = dated ? dated[2] : dirName;

  // The whole name is a slug somebody declares: the trailing digits are part of
  // the identity, not a suffix.
  if (knownSlugs.has(rest)) return { date, slug: rest, ambiguous: false };

  const collided = COLLISION_SUFFIX.exec(rest);
  if (!collided) return { date, slug: rest, ambiguous: false };

  const base = collided[1];
  const collision = Number(collided[2]);
  // The stem is a slug somebody declares: this really is a collision.
  if (knownSlugs.has(base)) return { date, slug: base, collision, ambiguous: false };

  // Nothing in the context explains the name. Read it as a collision, which is
  // what `claimArchiveName` produces, but say so: a caller that WRITES from
  // this must refuse instead of guessing.
  return { date, slug: base, collision, ambiguous: true };
}
