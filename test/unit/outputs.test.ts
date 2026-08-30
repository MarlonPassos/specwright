import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPattern, matchesOutputPattern, outputExists, resolveOutputs } from '../../src/core/schema/outputs.js';
import { makeTempDir } from '../helpers/workspace.js';

describe('output patterns', () => {
  it('matches a literal path only against itself', () => {
    expect(matchesOutputPattern('proposal.md', 'proposal.md')).toBe(true);
    expect(matchesOutputPattern('proposal.md', 'design.md')).toBe(false);
    expect(isPattern('proposal.md')).toBe(false);
  });

  it('spans directories with **', () => {
    expect(matchesOutputPattern('specs/**/*.md', 'specs/user-auth/spec.md')).toBe(true);
    expect(matchesOutputPattern('specs/**/*.md', 'specs/identity/user-auth/spec.md')).toBe(true);
    expect(matchesOutputPattern('specs/**/*.md', 'specs/notes.md')).toBe(true);
    expect(matchesOutputPattern('specs/**/*.md', 'design.md')).toBe(false);
  });

  it('keeps * inside a single segment', () => {
    expect(matchesOutputPattern('specs/*.md', 'specs/a.md')).toBe(true);
    expect(matchesOutputPattern('specs/*.md', 'specs/a/b.md')).toBe(false);
  });
});

describe('resolveOutputs', () => {
  it('finds the files a pattern produces, and reports nothing when there are none', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, 'specs', 'user-auth'), { recursive: true });
    await fs.writeFile(path.join(dir, 'specs', 'user-auth', 'spec.md'), '#', 'utf8');
    await fs.writeFile(path.join(dir, 'proposal.md'), '#', 'utf8');

    expect(await resolveOutputs(dir, 'specs/**/*.md')).toEqual(['specs/user-auth/spec.md']);
    expect(await resolveOutputs(dir, 'proposal.md')).toEqual(['proposal.md']);
    expect(await resolveOutputs(dir, 'design.md')).toEqual([]);
    expect(await outputExists(dir, 'design.md')).toBe(false);
    expect(await outputExists(dir, 'specs/**/*.md')).toBe(true);
  });
});
