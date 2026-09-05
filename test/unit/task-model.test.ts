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

describe('bloco de evidência', () => {
  it('anexa cmd, resultado e em à tarefa acima', () => {
    const parsed = parseTasks(
      '## 1. Testes\n\n' +
        '- [x] 1.1 Teste de concorrência\n' +
        '      cmd: TEST_DATABASE_URL=x pytest -k scale\n' +
        '      resultado: 2 passed in 8.4s\n' +
        '      em: 2026-09-05T14:22Z\n'
    );

    expect(parsed.total).toBe(1);
    expect(parsed.tasks[0].evidence).toEqual({
      cmd: 'TEST_DATABASE_URL=x pytest -k scale',
      resultado: '2 passed in 8.4s',
      em: '2026-09-05T14:22Z',
    });
  });

  it('uma tarefa sem o bloco continua exatamente como antes', () => {
    const parsed = parseTasks('- [x] 1.1 feito\n- [ ] 1.2 pendente\n');
    expect(parsed.tasks.map((task) => task.evidence)).toEqual([undefined, undefined]);
    expect({ total: parsed.total, completed: parsed.completed }).toEqual({ total: 2, completed: 1 });
  });

  it('exige indentação: uma linha na coluna zero é prosa do documento', () => {
    const parsed = parseTasks('- [x] 1.1 feito\ncmd: isto não pertence à tarefa\n');
    expect(parsed.tasks[0].evidence).toBeUndefined();
  });

  it('ignora um bloco que não tem tarefa antes dele', () => {
    expect(() => parseTasks('      cmd: solto\n')).not.toThrow();
    expect(parseTasks('      cmd: solto\n').total).toBe(0);
  });
});
