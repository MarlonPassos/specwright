import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { writeFileAtomic, withStaging } from '../../src/util/fs.js';

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'fs-atomic-'));
}

describe('writeFileAtomic', () => {
  it('writes the file and leaves no temporary behind', async () => {
    const dir = await tempDir();
    const target = path.join(dir, 'out.txt');
    await writeFileAtomic(target, 'hello');
    expect(await fs.readFile(target, 'utf8')).toBe('hello');
    expect((await fs.readdir(dir)).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('keeps the existing file intact when the write throws', async () => {
    const dir = await tempDir();
    const target = path.join(dir, 'out.txt');
    await fs.writeFile(target, 'original');
    // A directory cannot be written as a file: rename onto it fails.
    await fs.mkdir(path.join(dir, 'blocker'));
    await expect(writeFileAtomic(path.join(dir, 'blocker'), 'x')).rejects.toThrow();
    expect(await fs.readFile(target, 'utf8')).toBe('original');
    expect((await fs.readdir(dir)).filter((name) => name.includes('.tmp'))).toEqual([]);
  });
});

describe('withStaging', () => {
  it('moves every staged file onto its destination', async () => {
    const dir = await tempDir();
    await withStaging(dir, async (stage) => {
      stage('a.md', 'alpha');
      stage(path.join('nested', 'b.md'), 'beta');
    });
    expect(await fs.readFile(path.join(dir, 'a.md'), 'utf8')).toBe('alpha');
    expect(await fs.readFile(path.join(dir, 'nested/b.md'), 'utf8')).toBe('beta');
    expect((await fs.readdir(dir)).some((name) => name.startsWith('.tmp-'))).toBe(false);
  });

  it('touches no destination and clears the staging dir when run rejects', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'a.md'), 'keep');
    await expect(
      withStaging(dir, async (stage) => {
        stage('a.md', 'overwrite');
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await fs.readFile(path.join(dir, 'a.md'), 'utf8')).toBe('keep');
    expect((await fs.readdir(dir)).some((name) => name.startsWith('.tmp-'))).toBe(false);
  });

  it('commits removals through the same staging transaction', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'keep.md'), 'old');
    await fs.writeFile(path.join(dir, 'retire.md'), 'retired');

    await withStaging(dir, async (stage, remove) => {
      stage('keep.md', 'new');
      remove('retire.md');
    });

    expect(await fs.readFile(path.join(dir, 'keep.md'), 'utf8')).toBe('new');
    await expect(fs.stat(path.join(dir, 'retire.md'))).rejects.toThrow();
    expect((await fs.readdir(dir)).some((name) => name.startsWith('.tmp-'))).toBe(false);
  });

  it('rejects a blocked destination before applying removals', async () => {
    const dir = await tempDir();
    await fs.mkdir(path.join(dir, 'blocked.md'));
    await fs.writeFile(path.join(dir, 'retire.md'), 'retired');

    await expect(
      withStaging(dir, async (stage, remove) => {
        stage('blocked.md', 'cannot replace a directory');
        remove('retire.md');
      })
    ).rejects.toThrow(/blocked\.md/);

    expect(await fs.stat(path.join(dir, 'retire.md'))).toBeTruthy();
    expect((await fs.readdir(dir)).some((name) => name.startsWith('.tmp-'))).toBe(false);
  });
});
