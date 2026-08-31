import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initWorkspace } from '../../src/core/init.js';
import { createChange } from '../../src/core/change/create.js';
import { computeStatus, resolveChangeContext } from '../../src/core/change/status.js';
import { buildInstructions } from '../../src/core/change/instructions.js';
import { archiveChange } from '../../src/core/archive/archive.js';
import { listChangeEntries, listSpecEntries } from '../../src/core/list.js';
import { showChange } from '../../src/core/show.js';
import { validateSpecContent } from '../../src/core/validate/spec-validator.js';
import { workspaceAt, listArchivedChanges } from '../../src/core/workspace.js';
import { loadConfig } from '../../src/core/config.js';
import { makeTempDir, makeWorkspace, seedChange, writeFile } from '../helpers/workspace.js';

describe('init', () => {
  it('creates the workspace and the harness files', async () => {
    const dir = await makeTempDir();
    const result = await initWorkspace(dir);

    expect(result.created).toBe(true);
    expect(result.harnesses).toEqual(['claude', 'codex', 'opencode', 'kiro']);
    expect(result.files).toHaveLength(28);

    for (const file of result.files) {
      await expect(fs.stat(path.join(dir, file.path))).resolves.toBeTruthy();
    }
    await expect(fs.stat(path.join(dir, 'spec', 'config.yaml'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(dir, 'spec', 'project.md'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(dir, 'spec', 'changes', 'archive'))).resolves.toBeTruthy();
  });

  it('keeps the configured schema and adds harnesses when re-run', async () => {
    const dir = await makeTempDir();
    await initWorkspace(dir, { harnesses: 'claude' });
    const second = await initWorkspace(dir, { harnesses: 'kiro' });

    expect(second.created).toBe(false);
    expect(second.harnesses).toEqual(['claude', 'kiro']);
    expect((await loadConfig(workspaceAt(dir))).schema).toBe('spec-driven');
  });

  it('does not overwrite an existing project description', async () => {
    const dir = await makeTempDir();
    await initWorkspace(dir);
    const projectFile = path.join(dir, 'spec', 'project.md');
    await fs.writeFile(projectFile, 'mine', 'utf8');
    await initWorkspace(dir);
    expect(await fs.readFile(projectFile, 'utf8')).toBe('mine');
  });
});

describe('change lifecycle', () => {
  it('walks a change from creation to a merged spec', async () => {
    const workspace = await makeWorkspace();

    const created = await createChange(workspace, 'add-data-export');
    expect(created.next).toEqual(['proposal']);

    let context = await resolveChangeContext(workspace, 'add-data-export');
    let status = await computeStatus(context);
    expect(status.ready).toBe(false);
    expect(status.artifacts.find((a) => a.id === 'proposal')!.state).toBe('ready');
    expect(status.artifacts.find((a) => a.id === 'tasks')!.missing).toEqual(['specs', 'design']);

    await seedChange(workspace, 'add-data-export');

    context = await resolveChangeContext(workspace, 'add-data-export');
    status = await computeStatus(context);
    expect(status.ready).toBe(true);
    expect(status.applyBlockedBy).toEqual([]);
    expect(status.tasks).toEqual({ total: 1, completed: 0 });

    const changes = await listChangeEntries(workspace);
    expect(changes).toEqual([
      { id: 'add-data-export', title: expect.any(String), deltas: 1, tasks: { total: 1, completed: 0 } },
    ]);

    const shown = await showChange(workspace, 'add-data-export', { deltasOnly: true });
    expect(shown.deltas).toEqual([
      expect.objectContaining({ capability: 'data-export', operation: 'ADDED', requirement: 'Self-service export' }),
    ]);

    await writeFile(
      path.join(workspace.changesPath, 'add-data-export', 'tasks.md'),
      '## 1. Export\n\n- [x] 1.1 Implement the writer and verify its unit test passes\n'
    );

    const result = await archiveChange(workspace, 'add-data-export', {
      now: new Date(2026, 0, 15),
    });
    expect(result.archivedAs).toBe('2026-01-15-add-data-export');
    expect(result.createdSpecs).toEqual(['data-export']);
    expect(await listArchivedChanges(workspace)).toEqual(['2026-01-15-add-data-export']);
    expect(await listChangeEntries(workspace)).toEqual([]);

    const specs = await listSpecEntries(workspace);
    expect(specs).toEqual([
      { capability: 'data-export', requirements: 1, purpose: expect.stringContaining('Lets a signed-in user') },
    ]);

    const merged = await fs.readFile(path.join(workspace.specsPath, 'data-export', 'spec.md'), 'utf8');
    expect(validateSpecContent('data-export', merged, { strict: true }).valid).toBe(true);
  });

  it('refuses to archive a change that does not validate', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c', { proposal: '## Why\n\ntoo short\n\n## What Changes\n\n- x\n' });
    await expect(archiveChange(workspace, 'c')).rejects.toThrow(/não está válida/);
  });

  it('refuses to archive while tasks are unchecked, unless forced', async () => {
    const workspace = await makeWorkspace();
    await seedChange(workspace, 'c');
    await expect(archiveChange(workspace, 'c')).rejects.toThrow(/tarefa\(s\) não marcada/);
    await expect(archiveChange(workspace, 'c', { force: true })).resolves.toBeTruthy();
  });

  it('skips the merge for a change that declares no spec deltas', async () => {
    const workspace = await makeWorkspace();
    const dir = await seedChange(workspace, 'c', { delta: null as unknown as string });
    await writeFile(path.join(dir, '.change.yaml'), 'schema: spec-driven\nskip_specs: true\n');
    await writeFile(path.join(dir, 'tasks.md'), '## 1. Work\n\n- [x] 1.1 done and verified\n');

    const result = await archiveChange(workspace, 'c');
    expect(result.specsSkipped).toBe(true);
    expect(result.createdSpecs).toEqual([]);
    expect(await listSpecEntries(workspace)).toEqual([]);
  });

  it('gives an archived name a suffix rather than overwriting history', async () => {
    const workspace = await makeWorkspace();
    await fs.mkdir(path.join(workspace.archivePath, '2026-01-15-c'), { recursive: true });
    await seedChange(workspace, 'c');
    await writeFile(path.join(workspace.changesPath, 'c', 'tasks.md'), '## 1. W\n\n- [x] 1.1 done\n');

    const result = await archiveChange(workspace, 'c', { now: new Date(2026, 0, 15) });
    expect(result.archivedAs).toBe('2026-01-15-c-2');
  });

  it('leaves the workspace untouched when a delta cannot be applied', async () => {
    const workspace = await makeWorkspace();
    await writeFile(
      path.join(workspace.specsPath, 'data-export', 'spec.md'),
      ['# Data Export', '', '## Purpose', '', 'Lets a user export their own data in a portable format, without support.', '', '## Requirements', '', '### Requirement: Existing', 'The system SHALL exist.', '', '#### Scenario: S', '- **WHEN** x', '- **THEN** y'].join('\n')
    );
    const before = await fs.readFile(path.join(workspace.specsPath, 'data-export', 'spec.md'), 'utf8');

    await seedChange(workspace, 'c', {
      delta: ['## MODIFIED Requirements', '', '### Requirement: Ghost', 'The system SHALL ghost.', '', '#### Scenario: S', '- **WHEN** x', '- **THEN** y'].join('\n'),
      tasks: '## 1. W\n\n- [x] 1.1 done\n',
    });

    await expect(archiveChange(workspace, 'c', { validate: false })).rejects.toThrow(/não declara/);
    expect(await fs.readFile(path.join(workspace.specsPath, 'data-export', 'spec.md'), 'utf8')).toBe(before);
    await expect(fs.stat(path.join(workspace.changesPath, 'c'))).resolves.toBeTruthy();
  });

  it('removes a spec whose last requirement was retired', async () => {
    const workspace = await makeWorkspace();
    await writeFile(
      path.join(workspace.specsPath, 'legacy', 'spec.md'),
      ['# Legacy', '', '## Purpose', '', 'The old capability that this change retires once and for all today.', '', '## Requirements', '', '### Requirement: Old', 'The system SHALL old.', '', '#### Scenario: S', '- **WHEN** x', '- **THEN** y'].join('\n')
    );
    await seedChange(workspace, 'c', {
      capability: 'legacy',
      delta: '## REMOVED Requirements\n\n### Requirement: Old\n**Reason**: gone\n**Migration**: none\n',
      tasks: '## 1. W\n\n- [x] 1.1 done\n',
    });

    const result = await archiveChange(workspace, 'c');
    expect(result.retiredSpecs).toEqual(['legacy']);
    await expect(fs.stat(path.join(workspace.specsPath, 'legacy'))).rejects.toThrow();
  });
});

describe('instructions', () => {
  it('carries the schema guidance, template, context and rules for an artifact', async () => {
    const workspace = await makeWorkspace();
    await writeFile(
      workspace.configPath,
      'schema: spec-driven\ncontext: |\n  Runs on Node.\nrules:\n  proposal:\n    - Keep it short\n'
    );
    await createChange(workspace, 'c');

    const context = await resolveChangeContext(workspace, 'c');
    const instructions = await buildInstructions(context, 'proposal');

    expect(instructions.kind).toBe('artifact');
    if (instructions.kind !== 'artifact') return;
    expect(instructions.instruction).toContain('**Why**');
    expect(instructions.template).toContain('## What Changes');
    expect(instructions.template).toContain('## Why');
    expect(instructions.context).toBe('Runs on Node.');
    expect(instructions.rules).toEqual(['Keep it short']);
    expect(instructions.outputPath).toBe(path.join(context.dir, 'proposal.md'));
    expect(instructions.outputIsPattern).toBe(false);
    expect(instructions.dependencies).toEqual([]);
  });

  it('marks the spec artifact as skipped for a change that opted out', async () => {
    const workspace = await makeWorkspace();
    await createChange(workspace, 'c', { skipSpecs: true });

    const context = await resolveChangeContext(workspace, 'c');
    const instructions = await buildInstructions(context, 'specs');
    expect(instructions.kind).toBe('artifact');
    if (instructions.kind !== 'artifact') return;
    expect(instructions.skipped).toBe(true);
    expect(instructions.warning).toContain('skip_specs');
  });

  it('reports the implement phase with what still blocks it', async () => {
    const workspace = await makeWorkspace();
    await createChange(workspace, 'c');

    const context = await resolveChangeContext(workspace, 'c');
    const instructions = await buildInstructions(context, 'implement');
    expect(instructions.kind).toBe('phase');
    if (instructions.kind !== 'phase') return;
    expect(instructions.tracks).toBe('tasks.md');
    expect(instructions.blockedBy).toEqual(['proposal', 'specs', 'design', 'tasks']);
  });

  it('rejects an artifact the schema does not declare', async () => {
    const workspace = await makeWorkspace();
    await createChange(workspace, 'c');
    const context = await resolveChangeContext(workspace, 'c');
    await expect(buildInstructions(context, 'ghost')).rejects.toThrow(/não tem o artefato "ghost"/);
  });
});
