import { SpecError } from '../../util/errors.js';
import { allHarnesses, getHarness, harnessIds } from './registry.js';
import type { HarnessAdapter } from './types.js';

/** Names the harness explicitly, for when detection cannot tell or gets it wrong. */
export const HARNESS_ENV_OVERRIDE = 'SPECS_HARNESS';

export interface DetectOptions {
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** The harnesses the workspace has commands generated for, in config order. */
  configured?: string[];
}

function isSet(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name];
  return value !== undefined && value !== '';
}

/**
 * Which harness is running this CLI, so its messages can spell commands the way
 * that harness accepts them.
 *
 * In order: an explicit `SPECS_HARNESS`, the environment the harness itself
 * sets, the workspace configuration, and finally the first supported harness.
 * A workspace usually has several harnesses configured, so a marker from the
 * running process wins over the configuration - and among several markers, one
 * the workspace configured wins over one it did not.
 */
export function detectHarness(options: DetectOptions = {}): HarnessAdapter {
  return resolveHarness(options).adapter;
}

/**
 * De onde saiu o harness que estamos usando.
 *
 * `chosen` é um pedido explícito (`SPECS_HARNESS`); `env` é um marcador do
 * processo que nos executou; `config` é o que o workspace declarou; `default` é
 * o primeiro suportado, porque não havia nada.
 *
 * A distinção existe porque um painel de longa duração roda FORA do harness: o
 * `specs serve` sobe no terminal, sem marcador nenhum, e cai no que a config
 * declarou. Mostrar isso como se fosse observado transforma "o primeiro harness
 * configurado" em "o harness que está rodando", que são coisas diferentes.
 */
export type HarnessSource = 'chosen' | 'env' | 'config' | 'default';

export interface ResolvedHarness {
  adapter: HarnessAdapter;
  source: HarnessSource;
}

export function resolveHarness(options: DetectOptions = {}): ResolvedHarness {
  const env = options.env ?? process.env;
  const configured = options.configured ?? [];

  const override = env[HARNESS_ENV_OVERRIDE]?.trim().toLowerCase();
  if (override) {
    const adapter = getHarness(override);
    if (!adapter) {
      throw new SpecError(
        `${HARNESS_ENV_OVERRIDE}="${override}" não é um harness suportado. Suportados: ${harnessIds().join(', ')}`,
        { code: 'unknown_harness' }
      );
    }
    return { adapter, source: 'chosen' };
  }

  const running = allHarnesses().filter((adapter) =>
    adapter.envMarkers.some((marker) => isSet(env, marker))
  );
  if (running.length > 0) {
    return {
      adapter: running.find((adapter) => configured.includes(adapter.id)) ?? running[0],
      source: 'env',
    };
  }

  const fromConfig = allHarnesses().find((adapter) => configured.includes(adapter.id));
  if (fromConfig) return { adapter: fromConfig, source: 'config' };
  return { adapter: allHarnesses()[0], source: 'default' };
}

/** How the running harness types one command. */
export function currentInvocation(commandId: string, options: DetectOptions = {}): string {
  return detectHarness(options).invocation(commandId);
}
