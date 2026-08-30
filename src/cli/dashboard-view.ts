import type { ChangePhase, DashboardChange, DashboardData } from '../core/dashboard.js';
import type { ArtifactState } from '../core/change/status.js';

export interface ViewOptions {
  color: boolean;
  /** Terminal width in columns. */
  width: number;
}

/**
 * The wordmark, drawn with half blocks so six pixel rows fit in three text rows.
 * Only the coloured mode uses it; it needs 49 columns and Unicode.
 */
const LOGO = [
  '█▀▀▀ █▀▀▄ █▀▀▀ ▄▀▀▀ █  █ █▀▀▄ ▀█▀ ▄▀▀▀ █  █ ▀▀█▀▀',
  '▀▀▀▄ █▀▀  █▀▀  █    █▄▄█ █▀█   █  █ ▄▄ █▀▀█   █',
  '▄▄▄▀ █    █▄▄▄ ▀▄▄▄ ▀██▀ █  █ ▄█▄ ▀▄▄█ █  █   █',
];
const LOGO_WIDTH = 49;

interface Theme {
  off: string;
  bold: string;
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
const COLOR: Theme = {
  off: '\u001b[0m',
  bold: '\u001b[1m',
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

const PLAIN: Theme = {
  off: '',
  bold: '',
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

const LABEL_WIDTH = 24;
const BAR_WIDTH = 12;
const PROGRESS_WIDTH = BAR_WIDTH + 12;
const DOTS_WIDTH = 12;

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function clip(text: string, width: number): string {
  return text.length <= width ? text : text.slice(0, Math.max(width - 1, 1)) + '…';
}

function bar(completed: number, total: number, theme: Theme, color: string): string {
  const filled = total > 0 ? Math.min(BAR_WIDTH, Math.round((completed / total) * BAR_WIDTH)) : 0;
  // A started checklist must show something, so a non-zero count never rounds to nothing.
  const cells = completed > 0 && filled === 0 ? 1 : filled;
  return color + theme.barOn.repeat(cells) + theme.off + theme.barOff.repeat(BAR_WIDTH - cells);
}

function progress(
  tasks: { total: number; completed: number } | undefined,
  theme: Theme,
  color: string
): string {
  if (!tasks || tasks.total === 0) return pad('sem tarefas', PROGRESS_WIDTH);
  const percent = Math.round((tasks.completed / tasks.total) * 100);
  const counts = tasks.completed + '/' + tasks.total;
  return bar(tasks.completed, tasks.total, theme, color) + ' ' + pad(counts, 7) + String(percent).padStart(3) + '%';
}

function artifactDots(change: DashboardChange, theme: Theme): string {
  const glyphs: Record<ArtifactState, { glyph: string; color: string }> = {
    done: { glyph: theme.dot.done, color: theme.green },
    ready: { glyph: theme.dot.ready, color: theme.cyan },
    blocked: { glyph: theme.dot.blocked, color: theme.off },
    skipped: { glyph: theme.dot.skipped, color: theme.off },
  };
  const drawn = change.artifacts
    .map((artifact) => {
      const cell = glyphs[artifact.state];
      return cell.color + cell.glyph + theme.off;
    })
    .join(' ');
  const visible = Math.max(change.artifacts.length * 2 - 1, 0);
  return drawn + ' '.repeat(Math.max(DOTS_WIDTH - visible, 0));
}

interface Section {
  phase: ChangePhase;
  title: string;
  accent: (theme: Theme) => string;
  mark: (theme: Theme) => string;
}

/** One section per phase, in workflow order. */
const SECTIONS: Section[] = [
  { phase: 'planning', title: 'EM PLANEJAMENTO', accent: (t) => t.yellow, mark: (t) => t.mark.active },
  { phase: 'implementing', title: 'IMPLEMENTANDO', accent: (t) => t.cyan, mark: (t) => t.mark.active },
  { phase: 'ready-to-archive', title: 'PRONTAS PARA ARQUIVAR', accent: (t) => t.green, mark: (t) => t.mark.ready },
  { phase: 'broken', title: 'COM PROBLEMA', accent: (t) => t.red, mark: (t) => t.mark.broken },
];

export function renderDashboard(data: DashboardData, options: ViewOptions): string {
  const theme = options.color ? COLOR : PLAIN;
  const width = Math.max(options.width || 80, 56);
  const nameWidth = Math.max(Math.min(width - (DOTS_WIDTH + PROGRESS_WIDTH + 6), 34), 16);
  const lines: string[] = [];

  const rule = (title: string): void => {
    const filler = Math.max(width - title.length - 4, 2);
    lines.push('');
    lines.push(' ' + theme.bold + title + theme.off + ' ' + theme.rule.repeat(filler));
  };

  lines.push('');
  if (options.color && width >= LOGO_WIDTH + 2) {
    for (const line of LOGO) lines.push(' ' + theme.cyan + line + theme.off);
    lines.push(' ' + theme.bold + data.projectName + theme.off + '  ·  schema ' + data.schema);
  } else {
    lines.push(
      ' ' + theme.cyan + theme.mark.spec + theme.off + ' ' + theme.bold + 'specwright' + theme.off +
        '  ·  ' + data.projectName + '  ·  schema ' + data.schema
    );
  }

  const active = data.changes.filter((change) => change.phase === 'planning' || change.phase === 'implementing');
  const ready = data.changes.filter((change) => change.phase === 'ready-to-archive');
  const broken = data.changes.filter((change) => change.phase === 'broken');

  rule('RESUMO');
  const kv = (mark: string, color: string, label: string, value: string): void => {
    lines.push(' ' + color + mark + theme.off + ' ' + pad(label, LABEL_WIDTH) + theme.bold + value + theme.off);
  };
  kv(theme.mark.active, theme.yellow, 'Changes ativas', String(active.length));
  kv(theme.mark.ready, theme.green, 'Prontas para arquivar', String(ready.length));
  kv(theme.mark.done, theme.green, 'Changes arquivadas', String(data.archive.count));
  if (broken.length > 0) kv(theme.mark.broken, theme.red, 'Changes com problema', String(broken.length));
  lines.push(
    ' ' + theme.cyan + theme.mark.task + theme.off + ' ' + pad('Tarefas', LABEL_WIDTH) +
      progress(data.totals.tasks, theme, theme.cyan)
  );
  kv(
    theme.mark.spec,
    theme.magenta,
    'Capacidades',
    data.specs.length + ' specs  ·  ' + data.totals.requirements + ' requisitos'
  );

  if (data.changes.length === 0) {
    lines.push('');
    lines.push(' Nenhuma change ativa  ·  ' + theme.cyan + '/spec-propose' + theme.off + ' abre a próxima.');
  }

  for (const section of SECTIONS) {
    const members = data.changes.filter((change) => change.phase === section.phase);
    if (members.length === 0) continue;
    const accent = section.accent(theme);

    rule(section.title);
    lines.push('   ' + pad('CHANGE', nameWidth) + '  ' + pad('ARTEFATOS', DOTS_WIDTH) + '  PROGRESSO');

    for (const change of members) {
      lines.push(
        ' ' + accent + section.mark(theme) + theme.off + ' ' + pad(clip(change.id, nameWidth), nameWidth) + '  ' +
          artifactDots(change, theme) + '  ' + progress(change.tasks, theme, accent)
      );
      if (change.error) {
        lines.push('   ' + theme.red + theme.arrow + theme.off + ' ' + change.error);
      } else if (change.blockedBy.length > 0) {
        lines.push('   ' + theme.arrow + ' falta ' + change.blockedBy.join(', '));
      }
      lines.push('   ' + theme.arrow + ' ' + theme.cyan + change.next + theme.off);
    }
  }

  if (data.specs.length > 0) {
    rule('CAPACIDADES');
    for (const spec of data.specs) {
      lines.push(
        ' ' + theme.magenta + theme.mark.spec + theme.off + ' ' + pad(clip(spec.capability, nameWidth), nameWidth) +
          '  ' + String(spec.requirements).padStart(3) + ' requisito(s)'
      );
    }
  }

  rule('ARQUIVO');
  lines.push('   ' + pad('Changes arquivadas', LABEL_WIDTH) + theme.bold + data.archive.count + theme.off);
  lines.push('   ' + pad('Última data', LABEL_WIDTH) + theme.bold + (data.archive.last ?? '-') + theme.off);
  lines.push('');

  // Trailing padding would survive into the repaint and light up as a stray
  // highlight when a line shrinks between frames.
  return lines.map((line) => line.replace(/\s+$/, '')).join('\n') + '\n';
}
