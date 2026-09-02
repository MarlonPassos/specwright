import path from 'node:path';
import { promises as fs } from 'node:fs';
import { SpecError } from '../util/errors.js';
import { ensureDir, pathExists, writeFileEnsured } from '../util/fs.js';
import { DEFAULT_SCHEMA, loadConfig, renderConfig, type WorkspaceConfig } from './config.js';
import { allHarnesses, resolveHarnesses, writeHarnessFiles, type GeneratedFile } from './harness/index.js';
import { allCommands } from './workflows/index.js';
import { ARCHIVE_DIR, PROJECT_FILE, workspaceAt, type Workspace } from './workspace.js';

export interface InitOptions {
  /** `all`, or a comma-separated list of harness ids. Defaults to all. */
  harnesses?: string;
  schema?: string;
}

export interface InitResult {
  workspace: Workspace;
  created: boolean;
  schema: string;
  harnesses: string[];
  files: GeneratedFile[];
  projectFileCreated: boolean;
}

const PROJECT_TEMPLATE = `# Contexto do projeto

<!--
Pano de fundo que toda change herda. O workflow injeta os ajustes que acompanham
este arquivo a partir de spec/config.yaml; mantenha este documento como o retrato
legível do projeto.
-->

## Purpose

<!-- O que este projeto é e a quem ele serve. -->

## Stack

<!-- Linguagens, frameworks, bancos de dados, gerenciador de pacotes. -->

## Conventions

<!-- Convenções de nomes, layout, testes e revisão que uma change precisa respeitar. -->

## Constraints

<!-- Plataformas, promessas de compatibilidade, limites de performance ou de conformidade. -->
`;
export async function initWorkspace(
  projectRoot: string,
  options: InitOptions = {}
): Promise<InitResult> {
  const resolvedRoot = path.resolve(projectRoot);
  await assertUsableDirectory(resolvedRoot);

  const workspace = workspaceAt(resolvedRoot);
  const existed = await pathExists(workspace.configPath);

  await ensureDir(workspace.specsPath);
  await ensureDir(workspace.changesPath);
  await ensureDir(path.join(workspace.changesPath, ARCHIVE_DIR));

  const adapters = resolveHarnesses(options.harnesses ?? 'all');
  const harnesses = adapters.map((adapter) => adapter.id);

  // An existing workspace keeps its schema and gains the newly selected
  // harnesses: re-running init to add a harness must not silently reset the
  // workflow schema the project already uses.
  const existing: WorkspaceConfig | undefined = existed ? await loadConfig(workspace) : undefined;
  const config: WorkspaceConfig = {
    ...(existing ?? {}),
    schema: options.schema ?? existing?.schema ?? DEFAULT_SCHEMA,
    harnesses: mergeHarnesses(existing?.harnesses, harnesses),
  };

  await writeFileEnsured(workspace.configPath, renderConfig(config));

  const projectFile = path.join(workspace.root, PROJECT_FILE);
  const projectFileCreated = !(await pathExists(projectFile));
  if (projectFileCreated) {
    await writeFileEnsured(projectFile, PROJECT_TEMPLATE);
  }

  const files = await writeHarnessFiles(resolvedRoot, adapters);

  return {
    workspace,
    created: !existed,
    schema: config.schema,
    harnesses: config.harnesses!,
    files,
    projectFileCreated,
  };
}

function mergeHarnesses(existing: string[] | undefined, selected: string[]): string[] {
  const known = allHarnesses().map((adapter) => adapter.id);
  const merged = new Set([...(existing ?? []), ...selected]);
  return known.filter((id) => merged.has(id));
}

async function assertUsableDirectory(target: string): Promise<void> {
  try {
    const stats = await fs.stat(target);
    if (!stats.isDirectory()) {
      throw new SpecError(`"${target}" não é um diretório`, { code: 'not_a_directory' });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await ensureDir(target);
      return;
    }
    throw error;
  }
}

/** Regenerates the harness command files an existing workspace declares. */
export async function updateWorkspace(
  workspace: Workspace,
  options: { harnesses?: string } = {}
): Promise<{ harnesses: string[]; files: GeneratedFile[]; commands: string[] }> {
  const config = await loadConfig(workspace);
  const selection = options.harnesses ?? config.harnesses?.join(',');

  if (!selection) {
    throw new SpecError('Nenhum harness configurado neste workspace', {
      code: 'no_harness',
      fix: `specs init --harnesses ${allHarnesses().map((a) => a.id).join(',')}`,
    });
  }

  const adapters = resolveHarnesses(selection);
  const files = await writeHarnessFiles(workspace.projectRoot, adapters);

  if (options.harnesses) {
    await writeFileEnsured(
      workspace.configPath,
      renderConfig({ ...config, harnesses: mergeHarnesses(config.harnesses, adapters.map((a) => a.id)) })
    );
  }

  return {
    harnesses: adapters.map((adapter) => adapter.id),
    files,
    commands: allCommands().map((command) => command.id),
  };
}
