import { SpecError } from '../../util/errors.js';
import { claudeAdapter } from './adapters/claude.js';
import { codexAdapter } from './adapters/codex.js';
import { kiroAdapter } from './adapters/kiro.js';
import { opencodeAdapter } from './adapters/opencode.js';
import type { HarnessAdapter } from './types.js';

/** The supported harnesses, in the order they are listed and prompted for. */
const ADAPTERS: HarnessAdapter[] = [claudeAdapter, codexAdapter, opencodeAdapter, kiroAdapter];

export function allHarnesses(): HarnessAdapter[] {
  return [...ADAPTERS];
}

export function harnessIds(): string[] {
  return ADAPTERS.map((adapter) => adapter.id);
}

export function getHarness(id: string): HarnessAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.id === id);
}

/** Stands in wherever a harness could not be identified. */
export function defaultHarness(): HarnessAdapter {
  return ADAPTERS[0];
}

/**
 * How a given harness types a command. The one place that falls back when the
 * harness is unknown, so no caller grows its own conditional for that case.
 */
export function invocationFor(harnessId: string | undefined, commandId: string): string {
  const adapter = harnessId ? getHarness(harnessId) : undefined;
  return (adapter ?? defaultHarness()).invocation(commandId);
}

/**
 * Turns a `--harnesses` value into adapters. Accepts `all`, or a
 * comma-separated list of ids. Unknown ids fail loudly: silently skipping one
 * would leave a harness without commands and no sign of why.
 */
export function resolveHarnesses(value: string): HarnessAdapter[] {
  const requested = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (requested.length === 0) {
    throw new SpecError('Nenhum harness selecionado', {
      code: 'no_harness',
      fix: `specs init --harnesses ${harnessIds().join(',')}`,
    });
  }

  if (requested.includes('all')) return allHarnesses();

  const unknown = requested.filter((id) => !getHarness(id));
  if (unknown.length > 0) {
    throw new SpecError(
      `Harness desconhecido: ${unknown.join(', ')}. Suportados: ${harnessIds().join(', ')}`,
      { code: 'unknown_harness' }
    );
  }

  // De-duplicated and ordered by the registry, so repeated ids and a different
  // input order still produce the same result.
  return allHarnesses().filter((adapter) => requested.includes(adapter.id));
}
