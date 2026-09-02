import path from 'node:path';
import { SpecError } from '../../util/errors.js';
import { ensureDir, pathExists, readFileIfExists, writeFileAtomic } from '../../util/fs.js';
import { sha256 } from './hashes.js';
import { isKebabCase, planPaths, resolveWithinRoot, PLANNED_CHANGES_DIR } from './paths.js';
import { renderManifest, type SourceDocument } from './model.js';
import { planExists } from './repository.js';
import { architectureTemplate, blankManifest, planDocTemplate } from './templates.js';

export interface CreatePlanOptions {
  name?: string;
  owner?: string;
  /** Source document paths, relative to the project root. */
  sources?: string[];
  now?: Date;
}

export interface CreatedPlan {
  plan: string;
  /** Plan directory, relative to the project root, POSIX separators. */
  path: string;
  revision: number;
  /** Everything written, relative to the project root, POSIX separators. */
  created: string[];
}

/**
 * Creates `planning/<id>/` with a `draft` manifest at `revision: 0`, the two
 * human documents and the `planned-changes/` directory. Idempotent by refusal:
 * an existing plan fails with `plan_exists` and nothing is touched.
 */
export async function createPlan(
  projectRoot: string,
  id: string,
  options: CreatePlanOptions = {}
): Promise<CreatedPlan> {
  if (!isKebabCase(id)) {
    throw new SpecError(
      `"${id}" não é um plan-id válido. Use kebab-case: letras minúsculas, dígitos e hifens.`,
      { code: 'invalid_plan' }
    );
  }

  if (await planExists(projectRoot, id)) {
    throw new SpecError(`O plano "${id}" já existe.`, {
      code: 'plan_exists',
      fix: 'specs project status',
    });
  }

  const paths = planPaths(projectRoot, id);

  const sourceDocuments: SourceDocument[] = [];
  for (const declared of options.sources ?? []) {
    const normalized = declared.replace(/\\/g, '/');
    const absolute = resolveWithinRoot(projectRoot, normalized, 'unsafe_source_path');
    const content = await readFileIfExists(absolute);
    if (content === undefined) {
      throw new SpecError(`O documento-fonte "${declared}" não existe.`, {
        code: 'source_not_found',
        fix: `specs project create ${id}`,
      });
    }
    const relative = path.relative(projectRoot, absolute).replace(/\\/g, '/');
    sourceDocuments.push({ path: relative, sha256: sha256(content) });
  }

  const name = options.name?.trim() || id;
  const manifest = blankManifest({
    id,
    name,
    owner: options.owner?.trim() || undefined,
    sources: sourceDocuments,
    now: options.now,
  });

  await ensureDir(paths.dir);
  await ensureDir(paths.plannedChangesDir);
  await writeFileAtomic(paths.manifest, renderManifest(manifest));
  await writeFileAtomic(paths.planDoc, planDocTemplate(name));
  await writeFileAtomic(paths.architecture, architectureTemplate(name));

  const rel = (target: string) => path.relative(projectRoot, target).replace(/\\/g, '/');
  return {
    plan: id,
    path: rel(paths.dir),
    revision: 0,
    created: [
      rel(paths.manifest),
      rel(paths.planDoc),
      rel(paths.architecture),
      `${rel(paths.dir)}/${PLANNED_CHANGES_DIR}/`,
    ],
  };
}
