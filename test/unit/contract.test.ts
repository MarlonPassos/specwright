import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_SCHEMA_VERSION,
  OVERVIEW_SCHEMA_VERSION,
  dashboardEnvelope,
  overviewEnvelope,
} from '../../src/core/contract.js';

const AT = new Date('2026-09-02T12:00:00.000Z');

describe('contrato de saída', () => {
  it('carimba versão e momento da leitura, preservando o payload', () => {
    const stamped = overviewEnvelope({ projectName: 'demo', focus: [] }, AT);
    expect(stamped).toEqual({
      projectName: 'demo',
      focus: [],
      overviewSchemaVersion: OVERVIEW_SCHEMA_VERSION,
      generatedAt: '2026-09-02T12:00:00.000Z',
    });
  });

  it('usa a chave própria de cada projeção', () => {
    expect(overviewEnvelope({}, AT)).toHaveProperty('overviewSchemaVersion');
    expect(dashboardEnvelope({}, AT)).toHaveProperty('dashboardSchemaVersion');
    expect(overviewEnvelope({}, AT)).not.toHaveProperty('dashboardSchemaVersion');
  });

  it('não sobrescreve um campo do payload que já se chame assim', () => {
    // O envelope vem depois: quem chama controla, e o carimbo é a verdade.
    const stamped = overviewEnvelope({ overviewSchemaVersion: 99 }, AT);
    expect(stamped.overviewSchemaVersion).toBe(OVERVIEW_SCHEMA_VERSION);
  });

  it('as duas versões são números inteiros positivos', () => {
    for (const v of [DASHBOARD_SCHEMA_VERSION, OVERVIEW_SCHEMA_VERSION]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('o resultado sobrevive a JSON.stringify sem perda', () => {
    const stamped = overviewEnvelope({ a: 1, b: ['x'], c: { d: null } }, AT);
    expect(JSON.parse(JSON.stringify(stamped))).toEqual(stamped);
  });
});
