import path from 'node:path';
import { promises as fs } from 'node:fs';
import { SpecError } from '../util/errors.js';
import { ensureDir, pathExists, writeFileEnsured } from '../util/fs.js';
import { DEFAULT_SCHEMA, loadConfig, renderConfig, type WorkspaceConfig } from './config.js';
import { allHarnesses, resolveHarnesses, writeHarnessFiles, type GeneratedFile } from './harness/index.js';
import { workflowCommands } from './workflows/index.js';
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

const PROJECT_TEMPLATE = `# Project Context

<!--
Background every change inherits. The workflow injects this file's companion
settings from spec/config.yaml; keep this document for the human-readable
picture of the project.
-->

## Purpose

<!-- What this project is and who it serves. -->

## Stack

<!-- Languages, frameworks, datastores, package manager. -->

## Conventions

<!-- Naming, layout, testing and review conventions a change must respect. -->

## Constraints

<!-- Platforms, compatibility promises, performance or compliance limits. -->
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
      throw new SpecError(`"${target}" is not a directory`, { code: 'not_a_directory' });
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
    throw new SpecError('No harness is configured for this workspace', {
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
    commands: workflowCommands().map((command) => command.id),
  };
}
