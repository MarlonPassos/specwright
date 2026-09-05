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
  /**
   * Opt-in to `specs project next` OFFERING a batch of Planned Changes to
   * propose in parallel. Separate from `defaultParallel` on purpose: that one
   * seeds a new change's own `.change.yaml`, and at propose-batch time the
   * changes do not exist yet - there is no `.change.yaml` to read the opt-in
   * from, so the decision can only live at the workspace level.
   */
  parallelPropose: z.boolean().optional(),
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

/**
 * A field with no natural default (free text, an arbitrary map) is commented
 * out with a short example instead of being written active and empty - an
 * empty `context: ""` looks like a deliberate choice to whoever reads the
 * file later, when it is really just "nobody has set this yet".
 */
function optionalSection(value: unknown, guidance: string[]): string {
  if (value === undefined) return guidance.join('\n');
  return stringifyYaml(value, { lineWidth: 0 }).trimEnd();
}

/**
 * Every field this build understands is present in the file from the moment
 * `specs init` writes it - active with its real default when there is one
 * (`defaultParallel`), commented out with guidance otherwise (`context`,
 * `rules`) - so a workspace's `config.yaml` is a menu of what can be set,
 * not something you can only edit correctly after reading the docs first.
 */
export function renderConfig(config: WorkspaceConfig): string {
  const sections = [
    `schema: ${config.schema}`,
    optionalSection(config.harnesses !== undefined ? { harnesses: config.harnesses } : undefined, [
      '# Harnesses para os quais os comandos /spec-* são gerados. Mantido por',
      '# `specs init --harnesses <lista>`; editar aqui não gera nem apaga arquivo.',
      '# harnesses: [claude, codex, opencode, kiro]',
    ]),
    optionalSection(config.context !== undefined ? { context: config.context } : undefined, [
      '# Contexto injetado em toda instrução de artefato - convenções do projeto',
      '# que valem pra qualquer change. Descomente e preencha se project.md não bastar.',
      '# context: ""',
    ]),
    optionalSection(config.rules !== undefined ? { rules: config.rules } : undefined, [
      '# Regras extras por artefato (id do artefato -> lista de regras), injetadas',
      '# na instrução dele. Exemplo:',
      '# rules:',
      '#   design: ["Nunca proponha nova dependência sem listar alternativas."]',
    ]),
    [
      '# Liga dispatch paralelo isolado por worktree como padrão pra toda change',
      '# nova (`specs new change`). Uma change específica sempre pode ligar ou',
      '# desligar na hora com --parallel/--no-parallel, não importa este valor.',
      `defaultParallel: ${config.defaultParallel ?? false}`,
    ].join('\n'),
    [
      '# Deixa `specs project next` oferecer um lote de Planned Changes pra',
      '# propor em paralelo (um subagente por change, quando nenhuma delas',
      '# depende da outra). Só oferece: quem dispara o lote é sempre você.',
      `parallelPropose: ${config.parallelPropose ?? false}`,
    ].join('\n'),
  ];
  return sections.join('\n\n') + '\n';
}
