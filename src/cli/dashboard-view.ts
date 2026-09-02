import { invocationFor } from '../core/harness/registry.js';
import type { ChangePhase, DashboardChange, DashboardData } from '../core/dashboard.js';
import type { ArtifactState } from '../core/change/status.js';
import {
  DOTS_WIDTH,
  LABEL_WIDTH,
  LOGO_WIDTH,
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

export type { ViewOptions };

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
  const theme = themeFor(options);
  const width = Math.max(options.width || 80, 56);
  const view: ViewOptions = { color: options.color, width };
  const nameWidth = Math.max(Math.min(width - (DOTS_WIDTH + PROGRESS_WIDTH + 6), 34), 16);
  const lines: string[] = [];

  const rule = (title: string): void => {
    lines.push(...ruleLine(title, theme, width));
  };

  lines.push('');
  if (options.color && width >= LOGO_WIDTH + 2) {
    lines.push(
      ...header(theme.bold + data.projectName + theme.off + '  ·  schema ' + data.schema, theme, view)
    );
  } else {
    lines.push(...header(data.projectName + '  ·  schema ' + data.schema, theme, view));
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
    const propose = invocationFor(data.harness, 'propose');
    lines.push(' Nenhuma change ativa  ·  ' + theme.cyan + propose + theme.off + ' abre a próxima.');
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

  return frame(lines);
}
