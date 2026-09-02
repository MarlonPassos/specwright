import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { SpecError } from '../../util/errors.js';
import { localDateStamp } from '../../util/date.js';
import { pathExists, writeFileAtomic } from '../../util/fs.js';
import {
  PLAN_SCHEMA_VERSION,
  PlanManifestSchema,
  formatZodIssues,
  renderManifest,
  type PlanManifest,
} from './model.js';
import { planPaths, type PlanPaths } from './paths.js';

export interface LoadedPlan {
  manifest: PlanManifest;
  paths: PlanPaths;
  /** The exact bytes read from disk, for byte-identity checks. */
  raw: string;
}

export interface ManifestParse {
  manifest?: PlanManifest;
  issues: Array<{ path: string; message: string }>;
  /**
   * When true the manifest could not be built at all (bad YAML, unknown
   * version) and no graph/state reading is possible.
   */
  fatal: boolean;
  /** Set when the failure has its own error code (e.g. unsupported version). */
  code?: string;
  fix?: string;
}

export async function planExists(projectRoot: string, id: string): Promise<boolean> {
  return pathExists(planPaths(projectRoot, id).manifest);
}

/**
 * Parses raw `plan.yaml` text into a manifest, collecting field-path issues
 * rather than throwing, so `validate` can report every problem at once.
 */
export function parseManifest(raw: string): ManifestParse {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    return {
      issues: [{ path: '(root)', message: `plan.yaml não é YAML válido: ${(error as Error).message}` }],
      fatal: true,
      code: 'invalid_plan',
    };
  }

  if (parsed === null || typeof parsed !== 'object') {
    return {
      issues: [{ path: '(root)', message: 'plan.yaml está vazio ou não é um mapa' }],
      fatal: true,
      code: 'invalid_plan',
    };
  }

  const version = (parsed as Record<string, unknown>).schema_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return {
      issues: [{ path: 'schema_version', message: 'schema_version ausente ou inválido; esperado 1' }],
      fatal: true,
      code: 'invalid_plan',
    };
  }
  if (version > PLAN_SCHEMA_VERSION) {
    return {
      issues: [
        {
          path: 'schema_version',
          message: `plan.yaml usa schema_version ${version}; esta versão do specwright entende até ${PLAN_SCHEMA_VERSION}`,
        },
      ],
      fatal: true,
      code: 'unsupported_plan_version',
      fix: 'npm install --global specwright@latest',
    };
  }

  const result = PlanManifestSchema.safeParse(parsed);
  if (!result.success) {
    return { issues: formatZodIssues(result.error), fatal: true, code: 'plan_invalid' };
  }

  return { manifest: result.data, issues: [], fatal: false };
}

/** Loads and validates a plan, throwing `SpecError` on any structural failure. */
export async function loadPlan(projectRoot: string, id: string): Promise<LoadedPlan> {
  const paths = planPaths(projectRoot, id);
  if (!(await pathExists(paths.manifest))) {
    throw new SpecError(`Nenhum plano "${id}" em planning/.`, {
      code: 'plan_not_found',
      fix: `specs project create ${id}`,
    });
  }

  const raw = await readFile(paths.manifest, 'utf8');
  const parsed = parseManifest(raw);
  if (!parsed.manifest) {
    const detail = parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    throw new SpecError(`plan.yaml inválido: ${detail}`, {
      code: parsed.code ?? 'plan_invalid',
      ...(parsed.fix ? { fix: parsed.fix } : { fix: 'specs project validate --json' }),
    });
  }

  return { manifest: parsed.manifest, paths, raw };
}

export interface SaveOptions {
  /** Fail with `plan_revision_conflict` when the on-disk revision differs. */
  expectRevision?: number;
  /** Skip the automatic `revision + 1` — used only by `create` for revision 0. */
  keepRevision?: boolean;
  now?: Date;
}

/**
 * Serializes a manifest deterministically and writes it atomically. Every write
 * bumps `revision` and refreshes `updated_at`, unless `keepRevision` is set.
 */
export async function savePlan(
  paths: PlanPaths,
  manifest: PlanManifest,
  options: SaveOptions = {}
): Promise<PlanManifest> {
  if (options.expectRevision !== undefined && options.expectRevision !== manifest.revision) {
    throw new SpecError(
      `A revisão no disco é ${manifest.revision}, mas o comando esperava ${options.expectRevision}.`,
      { code: 'plan_revision_conflict', fix: 'specs project status --json' }
    );
  }

  const next: PlanManifest = {
    ...manifest,
    revision: options.keepRevision ? manifest.revision : manifest.revision + 1,
    updated_at: options.keepRevision
      ? manifest.updated_at
      : localDateStamp(options.now ?? new Date()),
  };

  await writeFileAtomic(paths.manifest, renderManifest(next));
  return next;
}
