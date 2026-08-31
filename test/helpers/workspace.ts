import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { initWorkspace } from '../../src/core/init.js';
import { workspaceAt, type Workspace } from '../../src/core/workspace.js';

const execFileAsync = promisify(execFile);

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const cliEntry = path.join(projectRoot, 'bin', 'specs.js');

export async function makeTempDir(prefix = 'spec-test-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** A temp project with an initialised workspace. */
export async function makeWorkspace(options: { harnesses?: string } = {}): Promise<Workspace> {
  const dir = await makeTempDir();
  await initWorkspace(dir, { harnesses: options.harnesses ?? 'all' });
  return workspaceAt(dir);
}

export async function writeFile(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs the built CLI in `cwd`. Requires `npm run build` (the pretest step). */
export async function runCli(
  args: string[],
  cwd: string,
  options: { env?: Record<string, string> } = {}
): Promise<CliResult> {
  // The harness the CLI thinks it is running under decides how it spells the
  // commands it suggests, so a test that checks one pins it here.
  const env = { ...process.env, ...options.env };
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...args], { cwd, env });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', code: failure.code ?? 1 };
  }
}

export function parseJson<T = any>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

export const PROPOSAL = `## Why

Customers ask support for a copy of their own data, and every request costs hours of manual work.

## What Changes

- Add a self-service CSV export

## Capabilities

### New Capabilities

- \`data-export\`

## Impact

Export service.
`;

export const DELTA_SPEC = `## Purpose

Lets a signed-in user take their own data out of the product in a portable format, without support involvement.

## ADDED Requirements

### Requirement: Self-service export
The system SHALL let a signed-in user export their own data as a CSV file.

#### Scenario: Export succeeds
- **WHEN** a signed-in user requests an export
- **THEN** the system returns a CSV file with that user's data
`;

export const DESIGN = `## Context

See proposal.md.
`;

export const TASKS = `## 1. Export

- [ ] 1.1 Implement the writer and verify its unit test passes
`;

/** Writes a complete, valid change into a workspace. */
export async function seedChange(
  workspace: Workspace,
  id: string,
  overrides: { proposal?: string; delta?: string; design?: string; tasks?: string; capability?: string } = {}
): Promise<string> {
  const dir = path.join(workspace.changesPath, id);
  await writeFile(path.join(dir, '.change.yaml'), 'schema: spec-driven\n');
  await writeFile(path.join(dir, 'proposal.md'), overrides.proposal ?? PROPOSAL);
  await writeFile(path.join(dir, 'design.md'), overrides.design ?? DESIGN);
  await writeFile(path.join(dir, 'tasks.md'), overrides.tasks ?? TASKS);
  if (overrides.delta !== null) {
    await writeFile(
      path.join(dir, 'specs', overrides.capability ?? 'data-export', 'spec.md'),
      overrides.delta ?? DELTA_SPEC
    );
  }
  return dir;
}
