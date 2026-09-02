import { describe, expect, it } from 'vitest';
import {
  parsePlannedChange,
  renderPlannedChange,
  splitFrontmatter,
  sectionHasText,
} from '../../src/core/project/planned-change.js';

const VALID = `---
schema_version: 1
id: CH-002
slug: authentication
title: Autenticação
plan_revision: 3
---

# Objetivo

Permitir que uma pessoa se identifique.

# Escopo

- início de sessão

# Critérios macro

- uma sessão pode ser encerrada
`;

describe('planned change parser', () => {
  it('splits the frontmatter from the body', () => {
    const { frontmatter, body } = splitFrontmatter(VALID);
    expect(frontmatter).toContain('id: CH-002');
    expect(body.startsWith('# Objetivo')).toBe(true);
  });

  it('parses a valid document', () => {
    const parsed = parsePlannedChange(VALID);
    expect(parsed.frontmatter?.id).toBe('CH-002');
    expect(parsed.frontmatterError).toBeUndefined();
    expect(sectionHasText(parsed.sections, 'Critérios macro')).toBe(true);
    expect(parsed.deltaHeaders).toEqual([]);
  });

  it('reports a missing frontmatter', () => {
    const parsed = parsePlannedChange('# Objetivo\n\nx\n');
    expect(parsed.frontmatter).toBeUndefined();
    expect(parsed.frontmatterError).toMatch(/ausente/);
  });

  it('reports an id that does not match the pattern', () => {
    const parsed = parsePlannedChange(VALID.replace('id: CH-002', 'id: authentication'));
    expect(parsed.frontmatter).toBeUndefined();
    expect(parsed.frontmatterError).toMatch(/inválido/);
  });

  it('rejects an unknown frontmatter schema_version (§7.3 regra 2)', () => {
    const parsed = parsePlannedChange(VALID.replace('schema_version: 1', 'schema_version: 2'));
    expect(parsed.frontmatter).toBeUndefined();
    expect(parsed.frontmatterError).toMatch(/schema_version/);
  });

  it('flags a delta header', () => {
    const parsed = parsePlannedChange(`${VALID}\n## ADDED Requirements\n\n### Requirement: x\n`);
    expect(parsed.deltaHeaders).toContain('ADDED Requirements');
  });

  it('ignores a delta header inside a fenced block', () => {
    const parsed = parsePlannedChange(`${VALID}\n\`\`\`\n## ADDED Requirements\n\`\`\`\n`);
    expect(parsed.deltaHeaders).toEqual([]);
  });

  it('sees an empty required section as absent', () => {
    const parsed = parsePlannedChange(VALID.replace('- uma sessão pode ser encerrada\n', ''));
    expect(sectionHasText(parsed.sections, 'Critérios macro')).toBe(false);
  });
});

describe('planned change renderer', () => {
  it('render → parse is idempotent for a filled document', () => {
    const text = renderPlannedChange({
      id: 'CH-001',
      slug: 'foundation',
      title: 'Fundação',
      planRevision: 2,
      sections: {
        Objetivo: 'Entregar a base.',
        Escopo: '- estrutura de pastas',
        'Critérios macro': '- o build passa',
      },
    });
    const parsed = parsePlannedChange(text);
    expect(parsed.frontmatter).toMatchObject({ id: 'CH-001', slug: 'foundation', plan_revision: 2 });
    expect(sectionHasText(parsed.sections, 'Objetivo')).toBe(true);
    expect(sectionHasText(parsed.sections, 'Escopo')).toBe(true);
  });

  it('the bare skeleton fails validation by leaving Escopo and Critérios macro empty', () => {
    const parsed = parsePlannedChange(
      renderPlannedChange({ id: 'CH-001', slug: 'x', title: 'X', planRevision: 0 })
    );
    expect(sectionHasText(parsed.sections, 'Objetivo')).toBe(true);
    expect(sectionHasText(parsed.sections, 'Escopo')).toBe(false);
    expect(sectionHasText(parsed.sections, 'Critérios macro')).toBe(false);
  });
});

describe('renderPlannedChange — frontmatter serializado, nunca concatenado', () => {
  const hostile = [
    ['dois-pontos', 'Fundação: empacotamento e config'],
    ['hash', 'Suporte a #tags no filtro'],
    ['aspas', 'O modo "não-interativo"'],
    ['hífen inicial', '- item que parece lista'],
    ['chaves', 'Config {json} e [array]'],
    ['pipe', 'Export | import de dados'],
    ['crase e cifrão', 'Usar `$HOME` como base'],
  ] as const;

  it.each(hostile)('sobrevive a um título com %s', (_label, title) => {
    const parsed = parsePlannedChange(
      renderPlannedChange({ id: 'CH-001', slug: 'x', title, planRevision: 0 })
    );
    expect(parsed.frontmatterError).toBeUndefined();
    expect(parsed.frontmatter?.title).toBe(title);
  });

  it('não muda o frontmatter de um título simples', () => {
    const text = renderPlannedChange({ id: 'CH-001', slug: 'x', title: 'Título simples', planRevision: 2 });
    expect(text).toContain('title: Título simples');
    expect(text.startsWith('---\nschema_version: 1\nid: CH-001\nslug: x\n')).toBe(true);
  });
});
