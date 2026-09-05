import path from 'node:path';
import { readFileIfExists } from '../../util/fs.js';
import { findSection, parseSections } from '../markdown/sections.js';

export interface FollowUp {
  /** The id as written, e.g. `FU-1`. */
  id: string;
  /** The one-line statement after the id. */
  text: string;
  /** True when the checkbox is ticked: someone gave it a destination. */
  dispatched: boolean;
}

/** `- [ ] FU-1 · follow-up — texto` — the shape the design template teaches. */
const FOLLOW_UP = /^[-*]\s*\[( |x|X)\]\s*(FU-[A-Za-z0-9.]+)\b\s*(.*)$/;
/**
 * The `· follow-up —` decoration between the id and the statement. Stripped
 * separately rather than inside FOLLOW_UP because the label itself contains a
 * hyphen, and a single expression that tries to skip it either eats into the
 * word or stops in the middle of it.
 */
const DECORATION = /^(?:·[^—–]*)?[—–]\s*|^[-]\s+/;

/**
 * The follow-ups a design declared and nobody has dispatched.
 *
 * A follow-up is not a doubt: it is work the change is declaring belongs to a
 * different change. The most expensive thing this workflow ever lost went out
 * exactly this way — a design correctly recorded that customer fields were in
 * the source document, absent from the model, and out of scope for a change
 * that had ruled out migrations, and the whole thing was archived with it. The
 * public update endpoint shipped with no updatable field at all.
 *
 * Reported, never enforced: see `archive.ts`'s note on why a gate here would
 * either break the autonomous loop or be decided by the agent it is supposed to
 * check.
 */
export async function readFollowUps(changeDir: string): Promise<FollowUp[]> {
  const content = await readFileIfExists(path.join(changeDir, 'design.md'));
  if (content === undefined) return [];

  const section = findSection(parseSections(content), 'Perguntas em Aberto');
  if (section === undefined) return [];

  const found: FollowUp[] = [];
  for (const raw of section.content.split('\n')) {
    const match = FOLLOW_UP.exec(raw.trim());
    if (!match) continue;
    found.push({
      id: match[2],
      text: match[3].replace(DECORATION, '').trim(),
      dispatched: match[1].toLowerCase() === 'x',
    });
  }
  return found;
}

/** The ones still waiting for a destination. */
export function pendingFollowUps(followUps: FollowUp[]): FollowUp[] {
  return followUps.filter((entry) => !entry.dispatched);
}
