/**
 * The versioned output contract, shared by every consumer of a projection.
 *
 * The two version numbers used to be `const`s inside CLI command files —
 * `DASHBOARD_SCHEMA_VERSION` in `cli/commands/project.ts` and
 * `OVERVIEW_SCHEMA_VERSION` in `cli/commands/watch.ts`. A second renderer that
 * imported them from there would invert the dependency direction (core must not
 * be reachable only through the CLI), and a version bumped in one place would
 * diverge from the other in silence.
 */

/** Payload of `specs project --json`. */
export const DASHBOARD_SCHEMA_VERSION = 1;

/** Payload of `specs watch --json` and of the combined projection. */
export const OVERVIEW_SCHEMA_VERSION = 1;

/**
 * Stamps a projection with its schema version and the moment it was read.
 *
 * `generatedAt` is the read time, not a cache key: a projection is recomputed
 * from disk on every call, so two stamps differing is normal and says nothing
 * about the data having changed.
 */
export function envelope<T extends object>(
  payload: T,
  versionKey: 'dashboardSchemaVersion' | 'overviewSchemaVersion',
  version: number,
  now: Date = new Date()
): T & Record<string, unknown> {
  return { ...payload, [versionKey]: version, generatedAt: now.toISOString() };
}

/** `specs watch --json` and `GET /api/overview` must agree byte for byte. */
export function overviewEnvelope<T extends object>(payload: T, now?: Date): T & Record<string, unknown> {
  return envelope(payload, 'overviewSchemaVersion', OVERVIEW_SCHEMA_VERSION, now);
}

/** `specs project --json` and `GET /api/plan`. */
export function dashboardEnvelope<T extends object>(payload: T, now?: Date): T & Record<string, unknown> {
  return envelope(payload, 'dashboardSchemaVersion', DASHBOARD_SCHEMA_VERSION, now);
}
