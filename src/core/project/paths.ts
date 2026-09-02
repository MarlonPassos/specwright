import path from 'node:path';
import { realpathSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { SpecError } from '../../util/errors.js';
import { pathExists } from '../../util/fs.js';

/** Directory, at the project root, that holds every plan. Never under `spec/`. */
export const PLANNING_DIR = 'planning';
/** The structured manifest inside a plan directory. */
export const PLAN_FILE = 'plan.yaml';
/** The human plan document. */
export const PLAN_DOC_FILE = 'plan.md';
/** The architecture document. */
export const ARCHITECTURE_FILE = 'architecture.md';
/** Directory holding the materialized Planned Changes. */
export const PLANNED_CHANGES_DIR = 'planned-changes';

const KEBAB_CASE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function isKebabCase(value: string): boolean {
  return KEBAB_CASE.test(value);
}

export interface PlanPaths {
  /** The plan id, equal to the plan directory name. */
  id: string;
  /** Absolute path of `planning/<plan-id>/`. */
  dir: string;
  /** Absolute path of `planning/<plan-id>/plan.yaml`. */
  manifest: string;
  planDoc: string;
  architecture: string;
  plannedChangesDir: string;
}

export function planPaths(projectRoot: string, id: string): PlanPaths {
  const dir = path.join(projectRoot, PLANNING_DIR, id);
  return {
    id,
    dir,
    manifest: path.join(dir, PLAN_FILE),
    planDoc: path.join(dir, PLAN_DOC_FILE),
    architecture: path.join(dir, ARCHITECTURE_FILE),
    plannedChangesDir: path.join(dir, PLANNED_CHANGES_DIR),
  };
}

/** File name of a Planned Change, derived from its id and slug. */
export function plannedChangeFileName(id: string, slug: string): string {
  return `${id}-${slug}.md`;
}

/** Path of a Planned Change relative to the plan directory, POSIX separators. */
export function plannedChangeRelPath(id: string, slug: string): string {
  return `${PLANNED_CHANGES_DIR}/${plannedChangeFileName(id, slug)}`;
}

/** Absolute path of a Planned Change. */
export function plannedChangePath(planDir: string, id: string, slug: string): string {
  return path.join(planDir, PLANNED_CHANGES_DIR, plannedChangeFileName(id, slug));
}

/**
 * Lists the plan ids under `planning/`: every directory that holds a `plan.yaml`.
 * Sorted, so the result never depends on `readdir` order.
 */
export async function listPlanIds(projectRoot: string): Promise<string[]> {
  const base = path.join(projectRoot, PLANNING_DIR);
  let entries;
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await pathExists(path.join(base, entry.name, PLAN_FILE))) {
      ids.push(entry.name);
    }
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

/**
 * Resolves which plan a command acts on. Mirrors how the CLI resolves the
 * active change: one plan is used implicitly, none is `plan_not_found`, several
 * without an explicit id is `ambiguous_plan`.
 */
export async function resolvePlanId(projectRoot: string, explicit?: string): Promise<string> {
  if (explicit) {
    if (!isKebabCase(explicit)) {
      throw new SpecError(
        `"${explicit}" não é um plan-id válido. Use kebab-case: letras minúsculas, dígitos e hifens.`,
        { code: 'invalid_plan' }
      );
    }
    if (!(await pathExists(planPaths(projectRoot, explicit).manifest))) {
      throw new SpecError(`Nenhum plano "${explicit}" em ${PLANNING_DIR}/.`, {
        code: 'plan_not_found',
        fix: `specs project create ${explicit}`,
      });
    }
    return explicit;
  }

  const ids = await listPlanIds(projectRoot);
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) {
    throw new SpecError(`Nenhum plano encontrado em ${PLANNING_DIR}/.`, {
      code: 'plan_not_found',
      fix: 'specs project create <plan-id>',
    });
  }
  throw new SpecError(`Vários planos: ${ids.join(', ')}. Diga qual delas com <plan-id>.`, {
    code: 'ambiguous_plan',
    fix: 'specs project list',
  });
}

/**
 * Resolves a declared, relative path against an allowed root and returns the
 * absolute result. Rejects: an absolute path, any `..` segment, a NUL byte, and
 * a path that escapes the root once symlinks are resolved.
 */
export function resolveWithinRoot(
  root: string,
  declared: string,
  code: 'unsafe_plan_path' | 'unsafe_source_path' = 'unsafe_plan_path'
): string {
  if (declared.includes('\0')) {
    throw new SpecError('Path contém byte NUL.', { code });
  }
  if (path.isAbsolute(declared) || /^[a-zA-Z]:[\\/]/.test(declared)) {
    throw new SpecError(`Path absoluto não é permitido: ${declared}`, { code });
  }
  const segments = declared.split(/[\\/]+/);
  if (segments.includes('..')) {
    throw new SpecError(`Path com ".." não é permitido: ${declared}`, { code });
  }

  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, declared);
  if (!isWithin(resolvedRoot, candidate)) {
    throw new SpecError(`Path escapa da raiz permitida: ${declared}`, { code });
  }

  const real = realpathOfNearestExisting(candidate);
  if (real && !isWithin(realpathOrSelf(resolvedRoot), real)) {
    throw new SpecError(`Symlink escapa da raiz permitida: ${declared}`, { code });
  }

  return candidate;
}

/**
 * `resolveWithinRoot` for a READ path: returns `undefined` instead of throwing
 * when the declared path escapes the root. A manifest is untrusted input — a
 * `..` in a persisted path must make the read fail closed, never leak a file
 * from outside the project (I-8, NFR-08).
 */
export function safeResolve(root: string, declared: string): string | undefined {
  try {
    return resolveWithinRoot(root, declared);
  } catch {
    return undefined;
  }
}

function isWithin(root: string, target: string): boolean {
  if (target === root) return true;
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function realpathOrSelf(target: string): string {
  try {
    return realpathSync.native(target);
  } catch {
    return target;
  }
}

function realpathOfNearestExisting(target: string): string | undefined {
  let current = target;
  for (;;) {
    try {
      return realpathSync.native(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}
