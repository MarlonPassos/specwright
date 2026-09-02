/**
 * The visual language shared by `specs status` and `specs project`.
 *
 * Both painters used to carry their own idea of what a dashboard looks like:
 * one drew a wordmark, ruled sections, progress bars and glyph marks; the other
 * printed flat `label: value` lines. Keeping the primitives here is what stops
 * the two from drifting apart again.
 */

export interface ViewOptions {
  color: boolean;
  /** Terminal width in columns. */
  width: number;
}

export interface Theme {
  off: string;
  bold: string;
  dim: string;
  green: string;
  yellow: string;
  red: string;
  cyan: string;
  magenta: string;
  barOn: string;
  barOff: string;
  rule: string;
  arrow: string;
  dot: { done: string; ready: string; blocked: string; skipped: string };
  mark: { active: string; ready: string; done: string; broken: string; task: string; spec: string };
}

/**
 * Nothing legible is carried by colour alone, and nothing uses grey: bright black
 * and bright white are the two colours terminal themes move the most. Hierarchy
 * comes from weight and glyph; the accents only reinforce it.
 */
export const COLOR: Theme = {
  off: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  green: '\u001b[92m',
  yellow: '\u001b[93m',
  red: '\u001b[91m',
  cyan: '\u001b[96m',
  magenta: '\u001b[95m',
  barOn: '█',
  barOff: '░',
  rule: '─',
  arrow: '↳',
  dot: { done: '●', ready: '◆', blocked: '○', skipped: '⊘' },
  mark: { active: '●', ready: '◆', done: '✔', broken: '✖', task: '▸', spec: '◇' },
};

export const PLAIN: Theme = {
  off: '',
  bold: '',
  dim: '',
  green: '',
  yellow: '',
  red: '',
  cyan: '',
  magenta: '',
  barOn: '#',
  barOff: '.',
  rule: '-',
  arrow: '->',
  dot: { done: '#', ready: '+', blocked: '.', skipped: 'x' },
  mark: { active: '*', ready: '+', done: 'v', broken: '!', task: '-', spec: '-' },
};

export const LABEL_WIDTH = 24;
export const BAR_WIDTH = 12;
export const PROGRESS_WIDTH = BAR_WIDTH + 12;
export const DOTS_WIDTH = 12;

/**
 * The wordmark. Each letter is a 3x6 pixel glyph, with half blocks folding the six
 * pixel rows into three terminal rows; W takes five columns because at three it
 * reads as a U. Six pixel rows is what buys the clean strokes: at four, letters
 * like S and R have to fold two strokes into one cell and blur.
 * Only the coloured mode uses it; it needs 41 columns and Unicode.
 */
export const LOGO = [
  '█▀▀ █▀█ █▀▀ █▀▀ █   █ █▀█ ▀█▀ █▀▀ █ █ ▀█▀',
  '▀▀█ █▀▀ █▀▀ █   █ ▄ █ █▀▄  █  █ ▄ █▀█  █',
  '▄▄█ █   █▄▄ █▄▄ ▀▄▀▄▀ █ ▀ ▄█▄ █▄█ █ █  █',
];
export const LOGO_WIDTH = 41;

export function themeFor(options: ViewOptions): Theme {
  return options.color ? COLOR : PLAIN;
}

export function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

export function clip(text: string, width: number): string {
  return text.length <= width ? text : text.slice(0, Math.max(width - 1, 1)) + '…';
}

export function bar(completed: number, total: number, theme: Theme, color: string): string {
  const filled = total > 0 ? Math.min(BAR_WIDTH, Math.round((completed / total) * BAR_WIDTH)) : 0;
  // A started checklist must show something, so a non-zero count never rounds to nothing.
  const cells = completed > 0 && filled === 0 ? 1 : filled;
  return color + theme.barOn.repeat(cells) + theme.off + theme.barOff.repeat(BAR_WIDTH - cells);
}

/** A bar plus `done/total` and a percentage, padded to `PROGRESS_WIDTH`. */
export function progress(
  counts: { total: number; completed: number } | undefined,
  theme: Theme,
  color: string,
  emptyLabel = 'sem tarefas'
): string {
  if (!counts || counts.total === 0) return pad(emptyLabel, PROGRESS_WIDTH);
  const percent = Math.round((counts.completed / counts.total) * 100);
  const label = counts.completed + '/' + counts.total;
  return bar(counts.completed, counts.total, theme, color) + ' ' + pad(label, 7) + String(percent).padStart(3) + '%';
}

/** Draws the section separator: ` TITLE --------`. */
export function ruleLine(title: string, theme: Theme, width: number): string[] {
  const filler = Math.max(width - title.length - 4, 2);
  return ['', ' ' + theme.bold + title + theme.off + ' ' + theme.rule.repeat(filler)];
}

/** The header line, with the wordmark when there is colour and room for it. */
export function header(subtitle: string, theme: Theme, options: ViewOptions): string[] {
  if (options.color && options.width >= LOGO_WIDTH + 2) {
    return [...LOGO.map((line) => ' ' + theme.cyan + line + theme.off), ' ' + subtitle];
  }
  return [
    ' ' + theme.cyan + theme.mark.spec + theme.off + ' ' + theme.bold + 'specwright' + theme.off +
      '  ·  ' + subtitle,
  ];
}

/**
 * Trailing padding would survive into a `--watch` repaint and light up as a
 * stray highlight when a line shrinks between frames.
 */
export function frame(lines: string[]): string {
  return lines.map((line) => line.replace(/\s+$/, '')).join('\n') + '\n';
}
