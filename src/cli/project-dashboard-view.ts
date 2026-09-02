import type { PlanStatus, ProjectChangeView } from '../core/project/status.js';
import type { NextRecommendation } from '../core/project/next.js';
import { describeReason } from '../core/project/state.js';
import {
  LABEL_WIDTH,
  PROGRESS_WIDTH,
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

const ID_WIDTH = 8;
const BRIEF_WIDTH = 10;

interface Section {
  title: string;
  /** Presentation values that land in this section, in the order they appear. */
  members: string[];
  accent: (theme: Theme) => string;
  mark: (theme: Theme) => string;
}

/**
 * One section per stage of the increment's life, in workflow order — the same
 * shape `specs status` uses for changes. A flat list sorted by id forced the
 * reader to scan every row to find the two that are actionable.
 */
const SECTIONS: Section[] = [
  {
    title: 'EM IMPLEMENTAÇÃO',
    members: ['em implementação', 'proposta'],
    accent: (t) => t.cyan,
    mark: (t) => t.mark.active,
  },
  {
    title: 'PRONTAS PARA COMEÇAR',
    members: ['pronta'],
    accent: (t) => t.green,
    mark: (t) => t.mark.ready,
  },
  {
    title: 'BLOQUEADAS',
    members: ['bloqueada'],
    accent: (t) => t.yellow,
    mark: (t) => t.dot.blocked,
  },
  {
    title: 'COM PROBLEMA',
    members: ['inconsistente'],
    accent: (t) => t.red,
    mark: (t) => t.mark.broken,
  },
  {
    title: 'CONCLUÍDAS',
    members: ['concluída'],
    accent: (t) => t.green,
    mark: (t) => t.mark.done,
  },
  {
    title: 'FORA DO FLUXO',
    members: ['ideia', 'pausada', 'cancelada'],
    accent: (t) => t.off,
    mark: (t) => t.dot.skipped,
  },
];

/** `atual` is the only healthy brief state; the rest need the reader's eye. */
function briefCell(change: ProjectChangeView, theme: Theme): string {
  if (!change.plannedChange) return theme.off + pad('—', BRIEF_WIDTH) + theme.off;
  const state = change.plannedChange.state;
  const label: Record<string, string> = {
    current: 'atual',
    outdated: 'desatual.',
    modified: 'editado',
    missing: 'ausente',
  };
  const color = state === 'current' ? theme.green : theme.yellow;
  return color + pad(label[state] ?? state, BRIEF_WIDTH) + theme.off;
}

/**
 * What the increment shows in the PROGRESSO column. A linked change reports its
 * checklist; everything else says where it is instead of drawing a fake bar.
 */
function progressCell(change: ProjectChangeView, theme: Theme, accent: string): string {
  if (change.execution === 'archived') return progress({ total: 1, completed: 1 }, theme, theme.green);
  if (change.link?.tasks) return progress(change.link.tasks, theme, accent, 'sem tarefas');
  if (change.link) return pad('vinculada', PROGRESS_WIDTH);
  return pad('sem change', PROGRESS_WIDTH);
}

/** Human dashboard for `specs project`. Read-only; mirrors `statusPayload`. */
export function renderProjectDashboard(
  status: PlanStatus,
  next: NextRecommendation,
  options: ViewOptions = { color: false, width: 80 }
): string {
  const theme = themeFor(options);
  const width = Math.max(options.width || 80, 56);
  const view: ViewOptions = { color: options.color, width };
  const nameWidth = Math.max(Math.min(width - (ID_WIDTH + BRIEF_WIDTH + PROGRESS_WIDTH + 8), 34), 16);
  const lines: string[] = [];

  const rule = (title: string): void => {
    lines.push(...ruleLine(title, theme, width));
  };
  const kv = (mark: string, color: string, label: string, value: string): void => {
    lines.push(' ' + color + mark + theme.off + ' ' + pad(label, LABEL_WIDTH) + theme.bold + value + theme.off);
  };

  const plan = status.plan;
  lines.push('');
  lines.push(
    ...header(
      theme.bold + plan.name + theme.off + '  ·  ' + plan.id + '  ·  revisão ' + plan.revision,
      theme,
      view
    )
  );

  // RESUMO
  const counts = status.progress;
  rule('RESUMO');
  lines.push(
    ' ' + theme.green + theme.mark.done + theme.off + ' ' + pad('Incrementos', LABEL_WIDTH) +
      progress({ total: counts.total, completed: counts.archived }, theme, theme.green, 'nenhum incremento')
  );
  kv(theme.mark.ready, theme.green, 'Prontas para começar', String(counts.ready));
  kv(theme.mark.active, theme.cyan, 'Em implementação', String(counts.inProgress));
  if (counts.blocked > 0) kv(theme.dot.blocked, theme.yellow, 'Bloqueadas', String(counts.blocked));
  const parked = counts.idea + counts.onHold + counts.cancelled;
  if (parked > 0) {
    kv(
      theme.dot.skipped,
      theme.off,
      'Fora do fluxo',
      `${counts.idea} ideia  ·  ${counts.onHold} pausada  ·  ${counts.cancelled} cancelada`
    );
  }
  kv(
    theme.mark.spec,
    theme.magenta,
    'Status do plano',
    plan.status + (plan.derivedStatus !== plan.status ? `  ·  derivado ${plan.derivedStatus}` : '') +
      (plan.owner ? `  ·  ${plan.owner}` : '')
  );

  // PRÓXIMO PASSO — the one thing the reader is here for.
  rule('PRÓXIMO PASSO');
  if (next.recommended) {
    const pick = next.recommended;
    lines.push(
      ' ' + theme.green + theme.mark.ready + theme.off + ' ' + theme.bold + pick.id + theme.off + '  ' + pick.title
    );
    for (const code of pick.reasonCodes) {
      lines.push('   ' + theme.arrow + ' ' + describeReason(code));
    }
    lines.push('   ' + theme.arrow + ' ' + theme.cyan + pick.startWith + theme.off);
    lines.push('   ' + theme.arrow + ' ' + theme.cyan + pick.thenLink + theme.off);
    if (next.parallelReady.length > 1) {
      lines.push(
        '   ' + theme.arrow + ' em paralelo: ' + next.parallelReady.filter((id) => id !== pick.id).join(', ')
      );
    }
  } else {
    lines.push(' ' + theme.dot.blocked + ' Nenhum incremento pronto.');
    const why = next.excluded.slice(0, 3);
    for (const item of why) {
      lines.push('   ' + theme.arrow + ' ' + item.id + ': ' + item.reasonCodes.map(describeReason).join('; '));
    }
  }

  // MILESTONES
  if (status.milestones.length > 0) {
    rule('MILESTONES');
    for (const milestone of status.milestones) {
      const done = milestone.derivedStatus === 'completed';
      const accent = done ? theme.green : milestone.derivedStatus === 'in_progress' ? theme.cyan : theme.off;
      const mark = done ? theme.mark.done : milestone.derivedStatus === 'in_progress' ? theme.mark.active : theme.dot.blocked;
      lines.push(
        ' ' + accent + mark + theme.off + ' ' + pad(clip(`${milestone.id} ${milestone.name}`, LABEL_WIDTH), LABEL_WIDTH) +
          progress({ total: milestone.total, completed: milestone.archived }, theme, accent, 'vazio')
      );
    }
  }

  // INCREMENTOS, grouped
  const placed = new Set<string>();
  for (const section of SECTIONS) {
    const members = status.changes.filter(
      (change) => section.members.includes(change.presentation) && !placed.has(change.id)
    );
    if (members.length === 0) continue;
    members.forEach((change) => placed.add(change.id));
    const accent = section.accent(theme);

    rule(section.title);
    lines.push(
      '   ' + pad('ID', ID_WIDTH) + pad('INCREMENTO', nameWidth) + '  ' + pad('BRIEF', BRIEF_WIDTH) +
        '  PROGRESSO'
    );

    for (const change of members) {
      lines.push(
        ' ' + accent + section.mark(theme) + theme.off + ' ' + pad(change.id, ID_WIDTH) +
          pad(clip(change.title, nameWidth), nameWidth) + '  ' + briefCell(change, theme) + '  ' +
          progressCell(change, theme, accent)
      );
      if (change.blockedBy.length > 0) {
        lines.push('   ' + theme.arrow + ' falta ' + change.blockedBy.join(', '));
      }
      for (const blocker of change.manualBlockers) {
        lines.push('   ' + theme.yellow + theme.arrow + theme.off + ' blocker: ' + blocker);
      }
      if (change.link) {
        lines.push('   ' + theme.arrow + ' vínculo: ' + change.link.name);
      }
      if (change.unlocks.length > 0 && change.execution !== 'archived') {
        lines.push('   ' + theme.arrow + ' desbloqueia ' + change.unlocks.join(', '));
      }
    }
  }

  // Anything a future presentation value adds must still be visible.
  const orphans = status.changes.filter((change) => !placed.has(change.id));
  if (orphans.length > 0) {
    rule('OUTROS');
    for (const change of orphans) {
      lines.push(
        ' ' + theme.dot.skipped + ' ' + pad(change.id, ID_WIDTH) + pad(clip(change.title, nameWidth), nameWidth) +
          '  ' + change.presentation
      );
    }
  }

  // DIAGNÓSTICOS
  rule('DIAGNÓSTICOS');
  if (status.diagnostics.length === 0) {
    lines.push(' ' + theme.green + theme.mark.done + theme.off + ' Sem diagnósticos.');
  } else {
    for (const diagnostic of status.diagnostics) {
      const color =
        diagnostic.level === 'ERROR' ? theme.red : diagnostic.level === 'WARNING' ? theme.yellow : theme.cyan;
      const mark = diagnostic.level === 'ERROR' ? theme.mark.broken : theme.dot.blocked;
      lines.push(' ' + color + mark + theme.off + ' ' + pad(diagnostic.code, LABEL_WIDTH) + diagnostic.message);
      if (diagnostic.fix) lines.push('   ' + theme.arrow + ' ' + theme.cyan + diagnostic.fix + theme.off);
    }
  }
  lines.push('');

  return frame(lines);
}
