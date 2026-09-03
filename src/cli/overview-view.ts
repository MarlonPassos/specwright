import type { OverviewData, OverviewFocus } from '../core/overview.js';
import {
  LABEL_WIDTH,
  PROGRESS_WIDTH,
  bar,
  clip,
  frame,
  header,
  pad,
  progress,
  ruleLine,
  themeFor,
  type Theme,
  type ViewOptions,
} from './theme.js';

/** Below this the two columns stop fitting and stack instead. */
const TWO_COLUMN_MIN = 96;
const COLUMN_LABEL = 22;

/**
 * The screen that neither dashboard could be.
 *
 * `specs status` answers "what is being built"; `specs project` answers "where
 * are we in the plan". Both were true and neither was enough, because the row
 * that matters — this change IS that increment — lived only in the reader's
 * head. FOCO AGORA draws that edge; everything else on this screen is the
 * smallest summary of each side that makes the edge legible.
 */
export function renderOverview(data: OverviewData, options: ViewOptions): string {
  const theme = themeFor(options);
  const width = Math.max(options.width || 80, 56);
  const view: ViewOptions = { color: options.color, width };
  const lines: string[] = [];

  lines.push('');
  lines.push(...header(subtitle(data, theme), theme, view));

  summary(lines, data, theme, width);
  focus(lines, data, theme, width);
  recommended(lines, data, theme, width);
  milestones(lines, data, theme, width);
  diagnostics(lines, data, theme, width);

  lines.push('');
  return frame(lines);
}

function subtitle(data: OverviewData, theme: Theme): string {
  const parts = data.plan
    ? [theme.bold + data.plan.name + theme.off, data.plan.id, 'revisão ' + data.plan.revision]
    : [theme.bold + data.projectName + theme.off];
  parts.push('schema ' + data.schema);
  return parts.join('  ·  ');
}

/**
 * Execution on the left, plan on the right. Narrow terminals stack the two
 * blocks instead of squeezing them: a truncated number is worse than a scroll.
 */
function summary(lines: string[], data: OverviewData, theme: Theme, width: number): void {
  const execution: Array<[string, string, string, string]> = [
    [theme.mark.active, theme.yellow, 'Changes ativas', String(data.changes.active)],
    [theme.mark.ready, theme.green, 'Prontas para arquivar', String(data.changes.readyToArchive)],
    [theme.mark.done, theme.green, 'Changes arquivadas', String(data.changes.archived)],
    [
      theme.mark.spec,
      theme.magenta,
      'Capacidades',
      data.changes.capabilities + ' specs · ' + data.changes.requirements + ' req.',
    ],
  ];

  // `Incrementos` is deliberately absent here: it is the progress row below,
  // and printing the label twice was the first thing that read as a bug.
  const plan: Array<[string, string, string, string]> = data.increments
    ? [
        [theme.mark.ready, theme.green, 'Prontas para começar', String(data.increments.ready)],
        [theme.mark.active, theme.cyan, 'Em implementação', String(data.increments.inProgress)],
        [theme.dot.blocked, theme.yellow, 'Bloqueadas', String(data.increments.blocked)],
        [theme.mark.done, theme.green, 'Concluídos', String(data.increments.archived)],
      ]
    : [];

  const twoColumns = plan.length > 0 && width >= TWO_COLUMN_MIN;
  const cellWidth = Math.floor((width - 2) / 2);

  if (twoColumns) {
    lines.push('');
    lines.push(
      ' ' + theme.bold + 'EXECUÇÃO' + theme.off + ' ' + theme.rule.repeat(Math.max(cellWidth - 11, 2)) +
      '  ' + theme.bold + 'PLANO' + theme.off + ' ' + theme.rule.repeat(Math.max(width - cellWidth - 10, 2))
    );
    for (let index = 0; index < Math.max(execution.length, plan.length); index += 1) {
      const left = execution[index]
        ? kv(execution[index], theme, COLUMN_LABEL, cellWidth)
        : ' '.repeat(cellWidth);
      const right = plan[index] ? kv(plan[index], theme, COLUMN_LABEL, 0) : '';
      lines.push(left + '  ' + right);
    }
  } else {
    lines.push(...ruleLine('EXECUÇÃO', theme, width));
    for (const row of execution) lines.push(kv(row, theme, LABEL_WIDTH, 0));
    if (plan.length > 0) {
      lines.push(...ruleLine('PLANO', theme, width));
      for (const row of plan) lines.push(kv(row, theme, LABEL_WIDTH, 0));
    }
  }

  // Both progress bars live outside the columns: at PROGRESS_WIDTH they would
  // be the first thing a narrow window cut in half.
  lines.push(
    ' ' + theme.cyan + theme.mark.task + theme.off + ' ' + pad('Tarefas', LABEL_WIDTH) +
      progress(data.changes.tasks, theme, theme.cyan)
  );
  if (data.increments) {
    lines.push(
      ' ' + theme.green + theme.mark.done + theme.off + ' ' + pad('Incrementos', LABEL_WIDTH) +
        progress(
          { total: data.increments.total, completed: data.increments.archived },
          theme,
          theme.green,
          'nenhum incremento'
        )
    );
    lines.push(
      ' ' + theme.magenta + theme.mark.spec + theme.off + ' ' + pad('Status do plano', LABEL_WIDTH) +
        theme.bold + data.plan!.derivedStatus + theme.off
    );
  }
}

function kv(
  row: [string, string, string, string],
  theme: Theme,
  labelWidth: number,
  cellWidth: number
): string {
  const [mark, color, label, value] = row;
  const text = ' ' + color + mark + theme.off + ' ' + pad(label, labelWidth) + theme.bold + value + theme.off;
  if (cellWidth === 0) return text;
  const visible = 1 + 1 + 1 + labelWidth + value.length;
  return text + ' '.repeat(Math.max(cellWidth - visible, 0));
}

/**
 * The paired rows come first, then the leftovers. A leftover is never noise:
 * an increment running with no change is work that was never linked, and a
 * change with no increment is work the plan cannot see.
 */
function focus(lines: string[], data: OverviewData, theme: Theme, width: number): void {
  if (data.focus.length === 0) {
    lines.push(...ruleLine('FOCO AGORA', theme, width));
    lines.push(' ' + theme.dim + 'Nada em andamento.' + theme.off);
    return;
  }

  const nameWidth = Math.max(Math.min(width - PROGRESS_WIDTH - 6, 34), 16);
  lines.push(...ruleLine('FOCO AGORA', theme, width));

  for (const entry of data.focus) {
    lines.push(...focusRows(entry, theme, nameWidth));
  }
}

function focusRows(entry: OverviewFocus, theme: Theme, nameWidth: number): string[] {
  const rows: string[] = [];
  const accent = entry.change ? theme.cyan : theme.yellow;
  const head = entry.change ? entry.change.id : entry.increment!.id;
  const mark = entry.change ? theme.mark.active : theme.mark.broken;

  rows.push(
    ' ' + accent + mark + theme.off + ' ' + pad(clip(head, nameWidth), nameWidth) + '  ' +
      (entry.change ? progress(entry.change.tasks, theme, accent) : theme.dim + 'sem change ativa' + theme.off)
  );

  if (entry.increment) {
    const increment = entry.increment;
    const brief = increment.brief ? '  ·  brief ' + increment.brief : '';
    const milestone = increment.milestone ? '  ·  ' + increment.milestone : '';
    rows.push(
      '   ' + theme.arrow + ' ' + theme.bold + increment.id + theme.off + '  ' +
        clip(increment.title, nameWidth + 12) + milestone + brief
    );
    if (!entry.change) {
      rows.push(
        '   ' + theme.arrow + ' ' + theme.yellow + 'sem vínculo com uma change ativa' + theme.off
      );
    }
    if (increment.unlocks.length > 0) {
      rows.push('   ' + theme.arrow + ' desbloqueia ' + increment.unlocks.join(', '));
    }
  } else {
    rows.push('   ' + theme.arrow + ' ' + theme.dim + 'nenhum incremento do plano reivindica esta change' + theme.off);
  }

  if (entry.change) rows.push('   ' + theme.arrow + ' ' + theme.cyan + entry.change.next + theme.off);
  return rows;
}

function recommended(lines: string[], data: OverviewData, theme: Theme, width: number): void {
  if (!data.recommended) return;
  lines.push(...ruleLine('PRÓXIMO PASSO', theme, width));
  lines.push(
    ' ' + theme.green + theme.mark.ready + theme.off + ' ' + theme.bold + data.recommended.id +
      theme.off + '  ' + data.recommended.title
  );
  for (const command of data.recommended.commands) {
    lines.push('   ' + theme.arrow + ' ' + theme.cyan + command + theme.off);
  }
}

/** One line, all milestones: the detail belongs to the PLANO tab. */
function milestones(lines: string[], data: OverviewData, theme: Theme, width: number): void {
  if (!data.milestones || data.milestones.length === 0) return;
  lines.push(...ruleLine('MILESTONES', theme, width));

  for (const milestone of data.milestones) {
    const done = milestone.total > 0 && milestone.archived >= milestone.total;
    const color = done ? theme.green : milestone.archived > 0 ? theme.cyan : theme.off;
    lines.push(
      ' ' + color + (done ? theme.mark.done : theme.dot.blocked) + theme.off + ' ' +
        pad(clip(milestone.id + ' ' + milestone.name, LABEL_WIDTH), LABEL_WIDTH) +
        bar(milestone.archived, milestone.total, theme, color) +
        '  ' + milestone.archived + '/' + milestone.total
    );
  }
}

function diagnostics(lines: string[], data: OverviewData, theme: Theme, width: number): void {
  if (!data.plan) return;
  const { errors, warnings } = data.diagnostics;
  if (errors === 0 && warnings === 0) return;
  lines.push(...ruleLine('DIAGNÓSTICOS', theme, width));
  const parts: string[] = [];
  if (errors > 0) parts.push(theme.red + errors + ' erro(s)' + theme.off);
  if (warnings > 0) parts.push(theme.yellow + warnings + ' aviso(s)' + theme.off);
  lines.push(' ' + parts.join('  ·  ') + '  ' + theme.dim + '— veja a aba PLANO' + theme.off);
}
