import path from 'node:path';
import { readFileIfExists } from '../../util/fs.js';
import { findSection, parseSections } from '../markdown/sections.js';

export const VERIFICATION_FILE = 'verification.md';

export interface VerificationVerdict {
  /** `verification.md` exists in the change directory. */
  present: boolean;
  /** The `data:` stamp, verbatim, when the document carries one. */
  date?: string;
  /** Findings listed under `## Achados em aberto`, one per line. */
  openFindings: string[];
  /** True when the document says, in so many words, that nothing is open. */
  clean: boolean;
}

const DATE_LINE = /^\s*data:\s*(.+?)\s*$/m;
/** The document's own way of saying the list is empty. */
const NOTHING_OPEN = /^(nenhum|nenhuma|none|nada)\b/i;

/**
 * Reads the verdict `/spec-verify` leaves behind.
 *
 * Verify was the only step in the cycle that changed no file — `workflow.md`
 * said so plainly: "verify | um relatório; nenhum arquivo muda". It is also the
 * step that would have found, on its own, the requirement with no test, the
 * behaviour with no requirement, and the task whose evidence is a skipped test.
 * A step that valuable being the easiest to skip, and leaving nothing behind
 * when it does run, is the gap this closes.
 *
 * The parse is forgiving by design: the document is written by an agent for a
 * human, not by a machine for a machine. What matters is whether it exists,
 * roughly when it was written, and whether anything is still open.
 */
export async function readVerification(changeDir: string): Promise<VerificationVerdict> {
  const content = await readFileIfExists(path.join(changeDir, VERIFICATION_FILE));
  if (content === undefined) {
    return { present: false, openFindings: [], clean: false };
  }

  const date = DATE_LINE.exec(content)?.[1];
  const section = findSection(parseSections(content), 'Achados em aberto');

  // No section at all is not a clean bill: it is a document that never
  // answered the question. Only an explicit "nenhum" counts as answered.
  if (section === undefined) {
    return { present: true, ...(date ? { date } : {}), openFindings: [], clean: false };
  }

  const lines = section.content
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);

  const clean = lines.length === 0 ? false : lines.every((line) => NOTHING_OPEN.test(line));
  return {
    present: true,
    ...(date ? { date } : {}),
    openFindings: clean ? [] : lines,
    clean,
  };
}
