import path from 'node:path';
import { promises as fs } from 'node:fs';
import { findFilesNamed, pathExists, readFileIfExists, writeFileAtomic } from '../../util/fs.js';
import { parseSections, findSection } from '../markdown/sections.js';
import { parseDeltaSpec, type ParsedDeltaSpec } from '../markdown/deltas.js';
import { changeDir, type Workspace } from '../workspace.js';
import { SpecError } from '../../util/errors.js';

export const PROPOSAL_FILE = 'proposal.md';
export const DESIGN_FILE = 'design.md';
export const TASKS_FILE = 'tasks.md';
export const DELTA_SPEC_FILE = 'spec.md';

export interface Proposal {
  why: string;
  whatChanges: string;
  capabilities: string;
  impact: string;
}

export function parseProposal(content: string): Proposal {
  const sections = parseSections(content);
  return {
    why: findSection(sections, 'Why')?.content.trim() ?? '',
    whatChanges: findSection(sections, 'What Changes')?.content.trim() ?? '',
    capabilities: findSection(sections, 'Capabilities')?.content.trim() ?? '',
    impact: findSection(sections, 'Impact')?.content.trim() ?? '',
  };
}

export interface DeltaSpecFile extends ParsedDeltaSpec {
  /** Absolute path of the delta file. */
  filePath: string;
}

/**
 * Every delta spec inside a change, found by walking `specs/` for `spec.md`
 * files. Walking rather than listing one level deep keeps nested capability
 * paths such as `identity/user-auth` visible.
 */
export async function readDeltaSpecs(dir: string): Promise<DeltaSpecFile[]> {
  const specsRoot = path.join(dir, 'specs');
  if (!(await pathExists(specsRoot))) return [];

  const files = await findFilesNamed(specsRoot, DELTA_SPEC_FILE);
  const parsed: DeltaSpecFile[] = [];

  for (const relative of files) {
    const capability = relative.slice(0, -(DELTA_SPEC_FILE.length + 1));
    if (!capability) continue;
    const filePath = path.join(specsRoot, ...relative.split('/'));
    const content = await fs.readFile(filePath, 'utf8');
    parsed.push({ ...parseDeltaSpec(capability, content), filePath });
  }

  return parsed;
}

export interface Task {
  /** Task number as authored, e.g. `1.2`. */
  number: string;
  text: string;
  done: boolean;
  line: number;
  /** The `## N. <group>` header the task sits under, when there is one. */
  group?: string;
  /** Files this task declares it touches, from a `` `files: a.ts, b.ts` `` tag. Empty when not declared. */
  files: string[];
  /** Task numbers this task declares it depends on, from a `` `depends: 1.1` `` tag. Empty when not declared. */
  dependsOn: string[];
}

export interface TaskProgress {
  tasks: Task[];
  total: number;
  completed: number;
}

const TASK_LINE = /^\s*[-*]\s+\[( |x|X)\]\s*(?:([0-9]+(?:\.[0-9]+)*)\s+)?(.*)$/d;
const GROUP_HEADER = /^##\s+(.*\S)\s*$/;
const TASK_TAG = /`(files|depends):\s*([^`]*)`/g;

/**
 * Pulls `` `files: a.ts` `` / `` `depends: 1.1` `` tags out of a task's raw
 * text, so the checklist stays human-readable while the scheduler gets
 * structured data. A task that never declares a tag gets an empty array, not
 * `undefined` - every consumer can iterate without an optional check.
 */
function extractTaskTags(rawText: string): { text: string; files: string[]; dependsOn: string[] } {
  const files: string[] = [];
  const dependsOn: string[] = [];
  const text = rawText
    .replace(TASK_TAG, (_match, key: string, value: string) => {
      const values = value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (key === 'files') files.push(...values);
      if (key === 'depends') dependsOn.push(...values);
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text, files, dependsOn };
}

export function parseTasks(content: string): TaskProgress {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const tasks: Task[] = [];
  let group: string | undefined;

  lines.forEach((line, index) => {
    const header = GROUP_HEADER.exec(line);
    if (header) {
      group = header[1].trim();
      return;
    }
    const match = TASK_LINE.exec(line);
    if (!match) return;
    const { text, files, dependsOn } = extractTaskTags(match[3]);
    tasks.push({
      number: match[2] ?? '',
      text,
      done: match[1].toLowerCase() === 'x',
      line: index + 1,
      group,
      files,
      dependsOn,
    });
  });

  return {
    tasks,
    total: tasks.length,
    completed: tasks.filter((task) => task.done).length,
  };
}

export async function readTaskProgress(dir: string): Promise<TaskProgress | undefined> {
  const target = path.join(dir, TASKS_FILE);
  if (!(await pathExists(target))) return undefined;
  return parseTasks(await fs.readFile(target, 'utf8'));
}

/**
 * Flips one task's checkbox to done, in place, touching only that line.
 *
 * Idempotent: a task already marked done reports `changed: false` without
 * writing the file again. Every other line - including the tags and prose
 * around the box this function flips - passes through byte for byte, because
 * the replacement only ever touches the single character position the box's
 * own regex match reports (via the `d` flag's `.indices`), never the
 * surrounding text.
 */
export async function markTaskDone(dir: string, number: string): Promise<{ changed: boolean }> {
  const target = path.join(dir, TASKS_FILE);
  const raw = await readFileIfExists(target);
  if (raw === undefined) {
    throw new SpecError(`"${TASKS_FILE}" não existe em ${dir}`, { code: 'tasks_file_missing' });
  }

  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  let found = false;
  let changed = false;

  const updated = lines.map((line) => {
    const match = TASK_LINE.exec(line);
    if (!match || (match[2] ?? '') !== number) return line;
    found = true;
    if (match[1].toLowerCase() === 'x') return line;
    changed = true;
    const [start, end] = match.indices![1]!;
    return `${line.slice(0, start)}x${line.slice(end)}`;
  });

  if (!found) {
    throw new SpecError(`Tarefa "${number}" não existe em ${TASKS_FILE}`, { code: 'task_not_found' });
  }
  if (changed) {
    await writeFileAtomic(target, updated.join(eol));
  }
  return { changed };
}

export interface ChangeSummary {
  id: string;
  dir: string;
  title: string;
  deltaCount: number;
  tasks?: TaskProgress;
  modifiedAt: number;
}

export async function summarizeChange(
  workspace: Workspace,
  id: string
): Promise<ChangeSummary> {
  const dir = changeDir(workspace, id);
  const proposalPath = path.join(dir, PROPOSAL_FILE);
  const proposal = (await pathExists(proposalPath))
    ? parseProposal(await fs.readFile(proposalPath, 'utf8'))
    : undefined;
  const deltas = await readDeltaSpecs(dir);
  const tasks = await readTaskProgress(dir);
  const stats = await fs.stat(dir);

  return {
    id,
    dir,
    title: firstLine(proposal?.why) || id,
    deltaCount: deltas.reduce((count, spec) => count + spec.entries.length, 0),
    tasks,
    modifiedAt: stats.mtimeMs,
  };
}

function firstLine(text?: string): string {
  return text?.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
}
