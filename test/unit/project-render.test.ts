import { describe, expect, it } from 'vitest';
import { renderRoadmapBlock, spliceRoadmap } from '../../src/core/project/render.js';
import { ROADMAP_BEGIN, ROADMAP_END } from '../../src/core/project/templates.js';
import { manifest, change } from '../helpers/plan.js';

const rows = new Map([
  ['CH-001', { id: 'CH-001', title: 'Fundação', presentation: 'concluída', priority: 'critical', dependsOn: [] }],
  ['CH-002', { id: 'CH-002', title: 'Auth', presentation: 'pronta', priority: 'high', dependsOn: ['CH-001'] }],
]);

const data = manifest({
  revision: 7,
  milestones: [{ id: 'M1', name: 'Fundação', order: 1, changes: ['CH-001', 'CH-002'] }],
  changes: [
    change({ id: 'CH-001', slug: 'foundation', milestone: 'M1' }),
    change({ id: 'CH-002', slug: 'auth', depends_on: ['CH-001'], milestone: 'M1' }),
  ],
});

describe('renderRoadmapBlock', () => {
  it('builds a delimited block with a milestone table and progress', () => {
    const block = renderRoadmapBlock({ manifest: data, rows });
    expect(block.startsWith(ROADMAP_BEGIN)).toBe(true);
    expect(block.trimEnd().endsWith(ROADMAP_END)).toBe(true);
    expect(block).toContain('### M1 — Fundação');
    expect(block).toContain('| CH-001 | Fundação | concluída | critical | — |');
    expect(block).toContain('Progresso: 1/2');
    expect(block).toContain('revision 7');
  });
});

describe('spliceRoadmap', () => {
  const block = `${ROADMAP_BEGIN}\n## Roadmap\nnovo\n${ROADMAP_END}`;

  it('appends when the markers are absent', () => {
    const out = spliceRoadmap('# Plano\n\n## Visão\n\ntexto\n', block);
    expect(out).toContain('## Visão');
    expect(out).toContain(block);
  });

  it('replaces between the markers and preserves outside text byte for byte', () => {
    const doc = `# Plano\n\n## Visão\n\nhumano acima\n\n${ROADMAP_BEGIN}\nvelho\n${ROADMAP_END}\n\nhumano abaixo\n`;
    const out = spliceRoadmap(doc, block);
    expect(out).toContain('humano acima');
    expect(out).toContain('humano abaixo');
    expect(out).not.toContain('velho');
    expect(out).toContain('novo');
  });

  it('fails on unbalanced markers', () => {
    expect(() => spliceRoadmap(`x\n${ROADMAP_BEGIN}\nsem fim\n`, block)).toThrowError(
      /roadmap_markers_invalid|desbalanceados/
    );
  });
});
