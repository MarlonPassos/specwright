import { SpecError } from '../../util/errors.js';
import { ensureDir, isDirectory } from '../../util/fs.js';
import { localDateStamp } from '../../util/date.js';
import { loadConfig } from '../config.js';
import { loadSchema } from '../schema/loader.js';
import { changeDir, type Workspace } from '../workspace.js';
import { writeChangeMetadata } from './metadata.js';

const CHANGE_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * The kebab-case rule for a change slug, exported so Project Planning validates
 * a Project Change `slug` against exactly the same shape without duplicating it.
 */
export const SLUG_PATTERN = CHANGE_ID;

export function assertValidChangeId(id: string): string {
  if (!CHANGE_ID.test(id)) {
    throw new SpecError(
      `"${id}" não é um nome de change válido. Use kebab-case: letras minúsculas, dígitos e hifens.`,
      { code: 'invalid_change_name' }
    );
  }
  return id;
}

export interface CreateChangeOptions {
  schema?: string;
  goal?: string;
  skipSpecs?: boolean;
  parallel?: boolean;
}

export interface CreatedChange {
  id: string;
  dir: string;
  schema: string;
  /** Artifacts that can be written immediately, in build order. */
  next: string[];
}

export async function createChange(
  workspace: Workspace,
  id: string,
  options: CreateChangeOptions = {}
): Promise<CreatedChange> {
  assertValidChangeId(id);

  const dir = changeDir(workspace, id);
  if (await isDirectory(dir)) {
    throw new SpecError(`A change "${id}" já existe em ${dir}`, {
      code: 'change_exists',
      fix: `specs status --change ${id}`,
    });
  }

  const config = await loadConfig(workspace);
  const schema = await loadSchema(options.schema ?? config.schema, workspace);
  // An explicit --parallel/--no-parallel always wins; absent, the workspace's
  // own default (if any) decides. Either way the resolved value is what gets
  // written - never re-derived later from config.yaml.
  const parallel = options.parallel ?? config.defaultParallel;

  await ensureDir(dir);
  await writeChangeMetadata(dir, {
    schema: schema.name,
    created: localDateStamp(),
    ...(options.goal ? { goal: options.goal } : {}),
    ...(options.skipSpecs ? { skip_specs: true } : {}),
    ...(parallel ? { parallel: true } : {}),
  });

  return {
    id,
    dir,
    schema: schema.name,
    next: schema.graph.ready(new Set()),
  };
}
