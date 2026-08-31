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
    return adapter;
  }

  const running = allHarnesses().filter((adapter) =>
    adapter.envMarkers.some((marker) => isSet(env, marker))
  );
  if (running.length > 0) {
    return running.find((adapter) => configured.includes(adapter.id)) ?? running[0];
  }

  return allHarnesses().find((adapter) => configured.includes(adapter.id)) ?? allHarnesses()[0];
}

/** How the running harness types one command. */
export function currentInvocation(commandId: string, options: DetectOptions = {}): string {
  return detectHarness(options).invocation(commandId);
}
