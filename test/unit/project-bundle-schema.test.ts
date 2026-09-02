import { describe, expect, it } from 'vitest';
import { BUNDLE_VERSION, OperationSchema, parseBundle } from '../../src/core/project/bundle.js';
import {
  BUNDLE_EXAMPLE,
  BUNDLE_OPERATIONS,
  bundleContract,
  renderBundleContract,
} from '../../src/core/project/bundle-schema.js';

/** The op names the runtime actually accepts, read off the zod union. */
function realOps(): string[] {
  return OperationSchema.options.map((option) => option.shape.op.value as string);
}

/** The field names a given op actually accepts. */
function realFields(op: string): string[] {
  const option = OperationSchema.options.find((entry) => entry.shape.op.value === op)!;
  return Object.keys(option.shape).filter((key) => key !== 'op');
}

describe('bundle contract — stays honest', () => {
  it('documents exactly the operations the parser accepts', () => {
    expect(BUNDLE_OPERATIONS.map((entry) => entry.op).sort()).toEqual(realOps().sort());
  });

  it('documents exactly the fields each operation accepts', () => {
    for (const documented of BUNDLE_OPERATIONS) {
      expect(
        documented.fields.map((field) => field.name).sort(),
        `campos de ${documented.op}`
      ).toEqual(realFields(documented.op).sort());
    }
  });

  it('marks required vs optional the way the schema does', () => {
    for (const documented of BUNDLE_OPERATIONS) {
      const option = OperationSchema.options.find((entry) => entry.shape.op.value === documented.op)!;
      for (const field of documented.fields) {
        const shape = (option.shape as Record<string, { isOptional(): boolean }>)[field.name];
        expect(shape.isOptional(), `${documented.op}.${field.name}`).toBe(!field.required);
      }
    }
  });

  it('ships an example that the parser accepts', () => {
    expect(() => parseBundle(BUNDLE_EXAMPLE)).not.toThrow();
  });

  it('the example demonstrates $ref instead of a predicted CH-NNN', () => {
    const json = JSON.stringify(BUNDLE_EXAMPLE);
    expect(json).toMatch(/"ref":\s*"\$/);
    expect(json).not.toMatch(/CH-\d{3}/);
  });

  it('renders every operation in the text form', () => {
    const text = renderBundleContract(bundleContract(BUNDLE_VERSION)).join('\n');
    for (const op of realOps()) expect(text).toContain(op);
    expect(text).toContain('PlannedChangeSpec');
  });
});

describe('bundle errors — self-documenting', () => {
  it('an invalid bundle points at the schema command', () => {
    try {
      parseBundle({ expectRevision: 0 });
      throw new Error('deveria ter falhado');
    } catch (error) {
      expect((error as { code: string }).code).toBe('invalid_bundle');
      expect((error as { fix?: string }).fix).toContain('bundle-schema');
    }
  });

  it('an unsupported version points at the schema command', () => {
    try {
      parseBundle({ bundleVersion: 99, expectRevision: 0, operations: [] });
      throw new Error('deveria ter falhado');
    } catch (error) {
      expect((error as { code: string }).code).toBe('unsupported_bundle_version');
      expect((error as { fix?: string }).fix).toContain('bundle-schema');
    }
  });
});
