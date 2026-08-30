#!/usr/bin/env node
/**
 * Builds dist/ when the package is installed straight from git.
 *
 * `npm install --global git+...` leaks its own configuration — `global`, `prefix` and
 * friends — through the environment into the install npm runs to prepare the clone.
 * The clone therefore never gets its own devDependencies and `tsc` is not on PATH.
 * This resolves the compiler itself and, when it has to fetch it, does so with the
 * inherited npm configuration stripped, so the install lands in the clone.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

/** The typescript version the package develops against. */
const TYPESCRIPT = `typescript@${require(path.join(root, 'package.json')).devDependencies.typescript}`;

/** The environment npm hands a lifecycle script, minus everything it configured. */
function cleanEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('npm_config_') || key === 'npm_command' || key === 'npm_execpath') continue;
    env[key] = value;
  }
  return env;
}

function run(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** The compiler entry point, or undefined when typescript is not installed. */
function resolveCompiler() {
  try {
    return require.resolve('typescript/bin/tsc', { paths: [root] });
  } catch {
    return undefined;
  }
}

let compiler = resolveCompiler();

if (!compiler) {
  const npm = process.env.npm_execpath;
  if (!npm) {
    console.error('prepare: npm is not available to install the TypeScript compiler');
    process.exit(1);
  }
  // --ignore-scripts keeps this install from re-entering prepare.
  const status = run(
    [npm, 'install', TYPESCRIPT, '--no-save', '--no-audit', '--no-fund', '--ignore-scripts'],
    cleanEnv()
  );
  if (status !== 0) process.exit(status);
  compiler = resolveCompiler();
}

if (!compiler) {
  console.error('prepare: could not resolve the TypeScript compiler');
  process.exit(1);
}

process.exit(run([compiler, '-p', path.join(root, 'tsconfig.json')]));
