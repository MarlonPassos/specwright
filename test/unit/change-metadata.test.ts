import { describe, expect, it } from 'vitest';
import { readChangeMetadata, writeChangeMetadata } from '../../src/core/change/metadata.js';
import { makeTempDir } from '../helpers/workspace.js';

describe('change metadata — parallel opt-in', () => {
  it('defaults to false when the file does not exist', async () => {
    const dir = await makeTempDir();
    const state = await readChangeMetadata(dir);
    expect(state.parallel).toBe(false);
  });

  it('defaults to false when the file exists but never mentions parallel', async () => {
    const dir = await makeTempDir();
    await writeChangeMetadata(dir, { schema: 'spec-driven' });
    expect((await readChangeMetadata(dir)).parallel).toBe(false);
  });

  it('round-trips parallel: true', async () => {
    const dir = await makeTempDir();
    await writeChangeMetadata(dir, { schema: 'spec-driven', parallel: true });
    const state = await readChangeMetadata(dir);
    expect(state.parallel).toBe(true);
    expect(state.metadata?.parallel).toBe(true);
  });

  it('never turns true from malformed content', async () => {
    const dir = await makeTempDir();
    const { writeFile } = await import('../helpers/workspace.js');
    await writeFile(`${dir}/.change.yaml`, 'not: [valid, yaml structure for this schema');
    const state = await readChangeMetadata(dir);
    expect(state.malformed).toBe(true);
    expect(state.parallel).toBe(false);
  });
});
