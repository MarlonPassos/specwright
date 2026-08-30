import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, promises as fs } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { SpecError } from '../../util/errors.js';
import { listDirectories, pathExists } from '../../util/fs.js';
import type { Workspace } from '../workspace.js';
import { ArtifactGraph } from './graph.js';
import { WorkflowSchemaFileSchema, type WorkflowSchemaFile } from './types.js';

const SCHEMAS_DIR = 'schemas';
const SCHEMA_FILE = 'schema.yaml';
const TEMPLATES_DIR = 'templates';

export interface LoadedSchema {
  name: string;
  /** Directory holding schema.yaml and its templates. */
  dir: string;
  /** Where the schema was found: shipped with the tool, or in the workspace. */
  source: 'builtin' | 'workspace';
  file: WorkflowSchemaFile;
  graph: ArtifactGraph;
}

/** Directory of schemas shipped with the tool. */
export function builtinSchemasDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Walk up to the package root, which is the first ancestor holding `schemas/`.
  let current = here;
  for (;;) {
    const candidate = path.join(current, SCHEMAS_DIR);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return path.join(here, SCHEMAS_DIR);
    current = parent;
  }
}

/** Workspace-local schema directory, which overrides a built-in of the same name. */
export function workspaceSchemasDir(workspace: Workspace): string {
  return path.join(workspace.root, SCHEMAS_DIR);
}

export function validateSchemaName(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new SpecError(
      `"${name}" is not a valid schema name. Use lowercase letters, digits and hyphens.`,
      { code: 'invalid_schema_name' }
    );
  }
  return name;
}

export async function parseSchemaFile(content: string, origin: string): Promise<WorkflowSchemaFile> {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (error) {
    throw new SpecError(`${origin} is not valid YAML: ${(error as Error).message}`, {
      code: 'invalid_schema',
    });
  }

  const result = WorkflowSchemaFileSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new SpecError(`${origin} is not a valid schema: ${detail}`, { code: 'invalid_schema' });
  }

  return result.data;
}

export async function loadSchema(
  name: string,
  workspace?: Workspace
): Promise<LoadedSchema> {
  validateSchemaName(name);

  const candidates: Array<{ dir: string; source: LoadedSchema['source'] }> = [];
  if (workspace) {
    candidates.push({ dir: path.join(workspaceSchemasDir(workspace), name), source: 'workspace' });
  }
  candidates.push({ dir: path.join(builtinSchemasDir(), name), source: 'builtin' });

  for (const candidate of candidates) {
    const schemaPath = path.join(candidate.dir, SCHEMA_FILE);
    if (!(await pathExists(schemaPath))) continue;

    const content = await fs.readFile(schemaPath, 'utf8');
    const file = await parseSchemaFile(content, schemaPath);
    if (file.name !== name) {
      throw new SpecError(
        `${schemaPath} declares name "${file.name}" but lives in directory "${name}"`,
        { code: 'invalid_schema' }
      );
    }
    return { name, dir: candidate.dir, source: candidate.source, file, graph: ArtifactGraph.from(file) };
  }

  const available = (await listSchemas(workspace)).map((entry) => entry.name);
  throw new SpecError(
    `Unknown schema "${name}". Available: ${available.join(', ') || 'none'}`,
    { code: 'schema_not_found', fix: 'specs schemas' }
  );
}

export interface SchemaSummary {
  name: string;
  description?: string;
  version: number;
  source: LoadedSchema['source'];
}

/** Every schema that can be selected, workspace overrides shadowing built-ins. */
export async function listSchemas(workspace?: Workspace): Promise<SchemaSummary[]> {
  const summaries = new Map<string, SchemaSummary>();

  const collect = async (dir: string, source: LoadedSchema['source']): Promise<void> => {
    for (const name of await listDirectories(dir)) {
      if (summaries.has(name)) continue;
      const schemaPath = path.join(dir, name, SCHEMA_FILE);
      if (!(await pathExists(schemaPath))) continue;
      try {
        const file = await parseSchemaFile(await fs.readFile(schemaPath, 'utf8'), schemaPath);
        summaries.set(name, {
          name,
          description: file.description,
          version: file.version,
          source,
        });
      } catch {
        // A malformed schema is reported when it is selected, not while listing.
      }
    }
  };

  if (workspace) await collect(workspaceSchemasDir(workspace), 'workspace');
  await collect(builtinSchemasDir(), 'builtin');

  return [...summaries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function templatePath(schema: LoadedSchema, template: string): string {
  return path.join(schema.dir, TEMPLATES_DIR, template);
}

export async function readTemplate(schema: LoadedSchema, template: string): Promise<string> {
  const target = templatePath(schema, template);
  try {
    return await fs.readFile(target, 'utf8');
  } catch {
    throw new SpecError(`Template "${template}" is missing from schema "${schema.name}" (${target})`, {
      code: 'template_not_found',
    });
  }
}
