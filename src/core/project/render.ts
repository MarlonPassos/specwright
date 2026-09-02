import { SpecError } from '../../util/errors.js';
import { normalizeLineEndings } from '../markdown/sections.js';
import { ROADMAP_BEGIN, ROADMAP_END } from './templates.js';
import type { PlanManifest } from './model.js';

export interface RoadmapRow {
  id: string;
  title: string;
  presentation: string;
  priority: string;
  dependsOn: string[];
}

export interface RoadmapInput {
  manifest: PlanManifest;
  rows: Map<string, RoadmapRow>;
}

/** Builds the delimited roadmap block projected from the manifest. */
export function renderRoadmapBlock(input: RoadmapInput): string {
  const { manifest, rows } = input;
  const lines: string[] = [ROADMAP_BEGIN, '## Roadmap', ''];

  const milestones = [...manifest.milestones].sort((a, b) => a.order - b.order);
  const assigned = new Set<string>();

  const table = (ids: string[]): string[] => {
    const out = [
      '| ID | Incremento | Estado | Prioridade | Depende de |',
      '|---|---|---|---|---|',
    ];
    for (const id of ids) {
      const row = rows.get(id);
      if (!row) continue;
      const deps = row.dependsOn.length > 0 ? row.dependsOn.join(', ') : '—';
      out.push(`| ${id} | ${row.title} | ${row.presentation} | ${row.priority} | ${deps} |`);
    }
    return out;
  };

  const progress = (ids: string[]): string => {
    const done = ids.filter((id) => rows.get(id)?.presentation === 'concluída').length;
    return `Progresso: ${done}/${ids.length}`;
  };

  for (const milestone of milestones) {
    const ids = manifest.changes
      .filter((change) => change.milestone === milestone.id)
      .map((change) => change.id);
    ids.forEach((id) => assigned.add(id));
    lines.push(`### ${milestone.id} — ${milestone.name}`, '');
    if (ids.length === 0) {
      lines.push('_sem incrementos_', '');
    } else {
      lines.push(...table(ids), '', progress(ids), '');
    }
  }

  const loose = manifest.changes.filter((change) => !assigned.has(change.id)).map((c) => c.id);
  if (loose.length > 0) {
    lines.push('### Sem milestone', '', ...table(loose), '', progress(loose), '');
  }

  if (manifest.changes.length === 0) {
    lines.push('Ainda não há incrementos no plano.', '');
  }

  lines.push(
    `Projetado de plan.yaml — revision ${manifest.revision}, ${manifest.updated_at}. Não edite dentro dos marcadores.`,
    ROADMAP_END
  );
  return lines.join('\n');
}

/**
 * Replaces the roadmap block in `doc` with `block`, preserving every byte
 * outside the markers. Appends the block when the markers are absent; fails with
 * `roadmap_markers_invalid` when they are unbalanced or duplicated.
 */
export function spliceRoadmap(doc: string, block: string): string {
  const text = normalizeLineEndings(doc);
  const begins = countOccurrences(text, ROADMAP_BEGIN);
  const ends = countOccurrences(text, ROADMAP_END);

  if (begins === 0 && ends === 0) {
    const separator = text.endsWith('\n') ? '\n' : '\n\n';
    return `${text}${separator}${block}\n`;
  }
  if (begins !== 1 || ends !== 1) {
    throw new SpecError('Os marcadores do roadmap em plan.md estão desbalanceados.', {
      code: 'roadmap_markers_invalid',
      fix: 'remova o bloco e rode specs project generate',
    });
  }

  const start = text.indexOf(ROADMAP_BEGIN);
  const stop = text.indexOf(ROADMAP_END) + ROADMAP_END.length;
  if (stop <= start) {
    throw new SpecError('O marcador de fim do roadmap aparece antes do de início.', {
      code: 'roadmap_markers_invalid',
      fix: 'remova o bloco e rode specs project generate',
    });
  }
  return `${text.slice(0, start)}${block}${text.slice(stop)}`;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}
