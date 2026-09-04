import { describe, expect, it } from 'vitest';
import { createChange } from '../../src/core/change/create.js';
import { readChangeMetadata } from '../../src/core/change/metadata.js';
import { renderConfig } from '../../src/core/config.js';
import { writeFile, makeWorkspace } from '../helpers/workspace.js';

describe('workspace-level defaultParallel feeds .change.yaml at creation time only', () => {
  it('a change created without any flag stays parallel: false when the workspace sets no default', async () => {
    const workspace = await makeWorkspace();
    await createChange(workspace, 'demo');
    const dir = `${workspace.changesPath}/demo`;
    expect((await readChangeMetadata(dir)).parallel).toBe(false);
  });

  it('a change created without any flag inherits the workspace default when one is set', async () => {
    const workspace = await makeWorkspace();
    await writeFile(workspace.configPath, renderConfig({ schema: 'spec-driven', defaultParallel: true }));

    await createChange(workspace, 'demo');
    const dir = `${workspace.changesPath}/demo`;
    expect((await readChangeMetadata(dir)).parallel).toBe(true);
  });

  it('an explicit --parallel wins even with no workspace default', async () => {
    const workspace = await makeWorkspace();
    await createChange(workspace, 'demo', { parallel: true });
    const dir = `${workspace.changesPath}/demo`;
    expect((await readChangeMetadata(dir)).parallel).toBe(true);
  });

  it('an explicit --no-parallel overrides a workspace default of true', async () => {
    const workspace = await makeWorkspace();
    await writeFile(workspace.configPath, renderConfig({ schema: 'spec-driven', defaultParallel: true }));

    await createChange(workspace, 'demo', { parallel: false });
    const dir = `${workspace.changesPath}/demo`;
    expect((await readChangeMetadata(dir)).parallel).toBe(false);
  });

  it('flipping the workspace default later never touches a change created before the flip', async () => {
    const workspace = await makeWorkspace();
    await createChange(workspace, 'existing');

    await writeFile(workspace.configPath, renderConfig({ schema: 'spec-driven', defaultParallel: true }));

    const dir = `${workspace.changesPath}/existing`;
    expect((await readChangeMetadata(dir)).parallel).toBe(false);
  });
});
