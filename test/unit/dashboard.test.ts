import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../../src/core/dashboard.js';
import { renderDashboard } from '../../src/cli/dashboard-view.js';
import { fitFrame } from '../../src/cli/watch.js';
import { makeWorkspace, seedChange, writeFile } from '../helpers/workspace.js';

const PLAIN = { color: false, width: 100 };
/** No harness markers, so the dashboard falls back to the default harness. */
const CLAUDE_ENV = { env: {} };
const CODEX_ENV = { env: { SPECS_HARNESS: 'codex' } };
const ESC = String.fromCharCode(27);

describe('dashboard data', () => {
  it('places a change with missing artifacts in planning', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'c');
    await fs.rm(path.join(dir, 'tasks.md'));

    const data = await buildDashboard(workspace, CLAUDE_ENV);
    expect(data.changes).toHaveLength(1);
    expect(data.changes[0].phase).toBe('planning');
    expect(data.changes[0].blockedBy).toContain('tasks');
    expect(data.changes[0].next).toBe('/spec-continue');
  });

  it('places a planned change with open tasks in implementing', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c');

    const data = await buildDashboard(workspace, CLAUDE_ENV);
    expect(data.changes[0].phase).toBe('implementing');
    expect(data.changes[0].tasks).toEqual({ total: 1, completed: 0 });
    expect(data.changes[0].next).toBe('/spec-implement');
  });

  it('places a change with every task checked in ready-to-archive', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c', {
      tasks: '## 1. Export\n\n- [x] 1.1 Escrever o writer e confirmar o teste\n',
    });

    const data = await buildDashboard(workspace, CLAUDE_ENV);
    expect(data.changes[0].phase).toBe('ready-to-archive');
    expect(data.changes[0].next).toBe('/spec-archive');
  });

  it('reports an unreadable change instead of failing the whole dashboard', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'good');
    await writeFile(path.join(workspace.changesPath, 'bad', '.change.yaml'), 'schema: ghost\n');

    const data = await buildDashboard(workspace, CLAUDE_ENV);
    const bad = data.changes.find((change) => change.id === 'bad')!;
    expect(bad.phase).toBe('broken');
    expect(bad.error).toMatch(/ghost/);
    expect(data.changes.find((change) => change.id === 'good')!.phase).toBe('implementing');
  });

  it('serves the dashboard payload as JSON, not the drawing', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c');

    const data = await buildDashboard(workspace, CLAUDE_ENV);
    // The shape `specs status --json` publishes when no change is named.
    expect(Object.keys(data).sort()).toEqual(
      ['archive', 'changes', 'harness', 'projectName', 'schema', 'specs', 'totals', 'workspace'].sort()
    );
    expect(() => JSON.parse(JSON.stringify(data))).not.toThrow();
  });

  it('totals tasks across every change', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'a', { tasks: '## 1. G\n\n- [x] 1.1 uma\n- [ ] 1.2 outra\n' });
    await seedChange(workspace, 'b', { tasks: '## 1. G\n\n- [x] 1.1 uma\n' });

    const data = await buildDashboard(workspace, CLAUDE_ENV);
    expect(data.totals.tasks).toEqual({ total: 3, completed: 2 });
  });
});

describe('dashboard view', () => {
  it('renders the summary and one section per phase', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'em-curso');
    await seedChange(workspace, 'terminada', {
      tasks: '## 1. Export\n\n- [x] 1.1 Escrever o writer e confirmar o teste\n',
    });

    const output = renderDashboard(await buildDashboard(workspace, CLAUDE_ENV), PLAIN);
    expect(output).toContain('RESUMO');
    expect(output).toContain('IMPLEMENTANDO');
    expect(output).toContain('PRONTAS PARA ARQUIVAR');
    expect(output).toContain('em-curso');
    expect(output).toContain('terminada');
  });

  it('draws no escape sequence when colour is off', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c');

    const output = renderDashboard(await buildDashboard(workspace, CLAUDE_ENV), PLAIN);
    expect(output.includes(ESC)).toBe(false);
  });

  it('leaves no trailing padding on any line', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c');

    for (const line of renderDashboard(await buildDashboard(workspace, CLAUDE_ENV), PLAIN).split('\n')) {
      expect(line).toBe(line.replace(/\s+$/, ''));
    }
  });

  it('points at /spec-propose when there is nothing to show', async () => {
    const workspace = await makeWorkspace();
    expect(renderDashboard(await buildDashboard(workspace, CLAUDE_ENV), PLAIN)).toContain('/spec-propose');
  });

  it('spells the next command the way the running harness accepts it', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c');

    const data = await buildDashboard(workspace, CODEX_ENV);
    expect(data.harness).toBe('codex');
    expect(data.changes[0].next).toBe('$spec-implement');
    expect(data.changes[0].next).not.toContain('/spec-');
  });

  it('spells the idle hint for the running harness too', async () => {
    const workspace = await makeWorkspace();
    const output = renderDashboard(await buildDashboard(workspace, CODEX_ENV), PLAIN);

    expect(output).toContain('$spec-propose');
    expect(output).not.toContain('/spec-propose');
  });
});

describe('watch frames', () => {
  it('repaints from the top without clearing first', () => {
    const frame = fitFrame('uma\ndois', 40);
    expect(frame.startsWith(ESC + '[H')).toBe(true);
    expect(frame).toContain('uma' + ESC + '[K\ndois');
    expect(frame.endsWith(ESC + '[K' + ESC + '[J')).toBe(true);
  });

  it('cuts a frame taller than the window and says how much it hid', () => {
    const frame = fitFrame(Array.from({ length: 20 }, (_, index) => 'linha ' + index).join('\n'), 6);
    expect(frame).toContain('linha 3');
    expect(frame).not.toContain('linha 9');
    expect(frame).toMatch(/\+16 linha\(s\)/);
  });

  it('keeps every line when the window fits the frame', () => {
    const frame = fitFrame('uma\ndois\ntres', 80);
    expect(frame).toContain('tres');
    expect(frame).not.toContain('linha(s)');
  });
});
