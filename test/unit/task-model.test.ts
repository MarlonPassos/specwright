import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markTaskDone, parseTasks } from '../../src/core/change/model.js';
import { makeTempDir, writeFile } from '../helpers/workspace.js';

describe('parseTasks — files/depends tags', () => {
  it('parses a task with no tags exactly as before', () => {
    const { tasks } = parseTasks('- [ ] 1.1 Faz X\n');
    expect(tasks[0]).toMatchObject({ number: '1.1', text: 'Faz X', files: [], dependsOn: [] });
  });

  it('extracts files and depends tags and strips them from the visible text', () => {
    const { tasks } = parseTasks('- [ ] 2.1 Faz X `files: a.ts, b.ts` `depends: 1.1` — nota extra\n');
    expect(tasks[0].text).toBe('Faz X — nota extra');
    expect(tasks[0].files).toEqual(['a.ts', 'b.ts']);
    expect(tasks[0].dependsOn).toEqual(['1.1']);
  });

  it('leaves a done task marked done regardless of tags', () => {
    const { tasks } = parseTasks('- [x] 1.1 Faz X `files: a.ts`\n');
    expect(tasks[0].done).toBe(true);
  });
});

describe('markTaskDone', () => {
  async function tasksFile(content: string): Promise<string> {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'tasks.md'), content);
    return dir;
  }

  it('flips the checkbox and touches nothing else on the line', async () => {
    const dir = await tasksFile('- [ ] 1.1 Faz X `files: a.ts` — nota\n- [ ] 1.2 Faz Y\n');
    const result = await markTaskDone(dir, '1.1');
    expect(result.changed).toBe(true);
    const content = await fs.readFile(path.join(dir, 'tasks.md'), 'utf8');
    expect(content).toBe('- [x] 1.1 Faz X `files: a.ts` — nota\n- [ ] 1.2 Faz Y\n');
  });

  it('touches only the first of two duplicate-numbered lines - specs validate only warns about the duplicate, it never blocks it', async () => {
    const dir = await tasksFile('- [ ] 1.1 Faz X\n- [ ] 1.1 Faz Y (duplicata)\n');
    await markTaskDone(dir, '1.1');
    const content = await fs.readFile(path.join(dir, 'tasks.md'), 'utf8');
    expect(content).toBe('- [x] 1.1 Faz X\n- [ ] 1.1 Faz Y (duplicata)\n');
  });

  it('is idempotent on an already-done task', async () => {
    const dir = await tasksFile('- [x] 1.1 Faz X\n');
    const before = await fs.readFile(path.join(dir, 'tasks.md'), 'utf8');
    const result = await markTaskDone(dir, '1.1');
    expect(result.changed).toBe(false);
    expect(await fs.readFile(path.join(dir, 'tasks.md'), 'utf8')).toBe(before);
  });

  it('rejects a task number that does not exist', async () => {
    const dir = await tasksFile('- [ ] 1.1 Faz X\n');
    await expect(markTaskDone(dir, '9.9')).rejects.toThrow(/não existe/);
  });

  it('rejects a change with no tasks.md at all', async () => {
    const dir = await makeTempDir();
    await expect(markTaskDone(dir, '1.1')).rejects.toThrow(/não existe/);
  });
});
