import type { PlanStatus } from '../core/project/status.js';
import type { NextRecommendation } from '../core/project/next.js';

/** Human dashboard for `specs project`. Read-only; mirrors `statusPayload`. */
export function renderProjectDashboard(status: PlanStatus, next: NextRecommendation): string[] {
  const lines: string[] = [];
  const p = status.plan;

  lines.push(
    `${p.name}  (${p.id})`,
    `  revisão ${p.revision} · status ${p.status}` +
      (p.derivedStatus !== p.status ? ` (derivado: ${p.derivedStatus})` : '') +
      (p.owner ? ` · ${p.owner}` : ''),
    ''
  );

  const g = status.progress;
  lines.push(
    `Progresso: ${g.archived}/${g.total} concluídos (${g.percent}%)`,
    `  pronta ${g.ready} · bloqueada ${g.blocked} · em impl. ${g.inProgress} · ideia ${g.idea} · pausada ${g.onHold} · cancelada ${g.cancelled}`,
    ''
  );

  if (status.milestones.length > 0) {
    lines.push('Milestones:');
    for (const milestone of status.milestones) {
      lines.push(
        `  ${milestone.id} ${milestone.name.padEnd(24)} ${milestone.archived}/${milestone.total}  ${milestone.derivedStatus}`
      );
    }
    lines.push('');
  }

  lines.push('Incrementos:');
  for (const change of status.changes) {
    const deps = change.dependsOn.length > 0 ? ` ← ${change.dependsOn.join(', ')}` : '';
    lines.push(
      `  ${change.id}  ${change.title.padEnd(28)} ${change.presentation.padEnd(16)} ${change.priority}${deps}`
    );
    if (change.readinessReasons.length > 0) {
      lines.push(`       razões: ${change.readinessReasons.join(', ')}`);
    }
    if (change.plannedChange) {
      lines.push(`       brief: ${change.plannedChange.state}`);
    }
    if (change.link) {
      const tasks = change.link.tasks
        ? ` (${change.link.tasks.completed}/${change.link.tasks.total})`
        : '';
      lines.push(`       vínculo: ${change.link.name}${tasks}`);
    }
  }
  lines.push('');

  if (next.recommended) {
    lines.push(
      `Próximo: ${next.recommended.id} ${next.recommended.title}`,
      `  ${next.recommended.reasonCodes.join(', ')}`,
      `  comece com: ${next.recommended.startWith}`
    );
  } else {
    lines.push('Próximo: nenhum incremento pronto.');
  }
  lines.push('');

  if (status.diagnostics.length > 0) {
    lines.push('Diagnósticos:');
    for (const diagnostic of status.diagnostics) {
      lines.push(
        `  ${diagnostic.level.padEnd(7)} ${diagnostic.code} — ${diagnostic.message}` +
          (diagnostic.fix ? ` (${diagnostic.fix})` : '')
      );
    }
  } else {
    lines.push('Sem diagnósticos.');
  }

  return lines;
}
