import path from 'node:path';
import { promises as fs } from 'node:fs';
import { findFilesNamed, pathExists } from '../../util/fs.js';
import { parseSections, findSection } from '../markdown/sections.js';
import { parseDeltaSpec, type ParsedDeltaSpec } from '../markdown/deltas.js';
import { changeDir, type Workspace } from '../workspace.js';

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
}

export interface TaskProgress {
  tasks: Task[];
  total: number;
  completed: number;
}

const TASK_LINE = /^\s*[-*]\s+\[( |x|X)\]\s*(?:([0-9]+(?:\.[0-9]+)*)\s+)?(.*)$/;
const GROUP_HEADER = /^##\s+(.*\S)\s*$/;

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
    tasks.push({
      number: match[2] ?? '',
      text: match[3].trim(),
      done: match[1].toLowerCase() === 'x',
      line: index + 1,
      group,
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
