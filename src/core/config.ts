import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { SpecError } from '../util/errors.js';
import { readFileIfExists } from '../util/fs.js';
import type { Workspace } from './workspace.js';

export const DEFAULT_SCHEMA = 'spec-driven';

/**
 * Workspace configuration.
 *
 * `context` and `rules` are injected into artifact instructions: they are
 * constraints for whoever writes the artifact, never content to copy into it.
 */
export const WorkspaceConfigSchema = z.object({
  schema: z.string().min(1).default(DEFAULT_SCHEMA),
  context: z.string().optional(),
  rules: z.record(z.string(), z.array(z.string())).optional(),
  harnesses: z.array(z.string()).optional(),
  /**
   * Default for a new change's own `parallel:` field in `.change.yaml`, used
   * only at `specs new change` time. This is a convenience, not a second
   * gate: `specs instructions implement` never reads this file for the
   * decision, only the change's own `.change.yaml` - so flipping this later
   * can never retroactively enable parallel dispatch on a change that
   * already exists.
   */
  defaultParallel: z.boolean().optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const DEFAULT_CONFIG: WorkspaceConfig = { schema: DEFAULT_SCHEMA };

export async function loadConfig(workspace: Workspace): Promise<WorkspaceConfig> {
  const raw = await readFileIfExists(workspace.configPath);
  if (raw === undefined) {
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new SpecError(`${workspace.configPath} não é YAML válido: ${(error as Error).message}`, {
      code: 'invalid_config',
    });
  }

  if (parsed === null || parsed === undefined) {
    return { ...DEFAULT_CONFIG };
  }

  const result = WorkspaceConfigSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new SpecError(`${workspace.configPath} não é uma configuração válida: ${detail}`, {
      code: 'invalid_config',
    });
  }

  return result.data;
}

/** Rules that apply to one artifact id, in declaration order. */
export function rulesFor(config: WorkspaceConfig, artifactId: string): string[] {
  return config.rules?.[artifactId] ?? [];
}

export function renderConfig(config: WorkspaceConfig): string {
  const document: Record<string, unknown> = { schema: config.schema };
  if (config.context !== undefined) document.context = config.context;
  if (config.rules !== undefined) document.rules = config.rules;
  if (config.harnesses !== undefined) document.harnesses = config.harnesses;
  if (config.defaultParallel !== undefined) document.defaultParallel = config.defaultParallel;
  return stringifyYaml(document);
}
