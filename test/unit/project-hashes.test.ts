import { describe, expect, it } from 'vitest';
import { normalize, sha256, sourceHash, contentHash } from '../../src/core/project/hashes.js';

describe('project hashes', () => {
  it('normalizes CRLF and lone CR to LF', () => {
    expect(normalize('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('gives the same content hash for LF and CRLF inputs', () => {
    expect(contentHash('line one\nline two\n')).toBe(contentHash('line one\r\nline two\r\n'));
  });

  it('hashes multiple sources in declared order', () => {
    const forward = sourceHash([
      { path: 'a.md', content: 'alpha' },
      { path: 'b.md', content: 'beta' },
    ]);
    const reversed = sourceHash([
      { path: 'b.md', content: 'beta' },
      { path: 'a.md', content: 'alpha' },
    ]);
    expect(forward).not.toBe(reversed);
  });

  it('treats a missing source as empty but still order-sensitive', () => {
    const withMissing = sourceHash([
      { path: 'a.md', content: 'alpha' },
      { path: 'b.md', content: undefined },
    ]);
    const bothEmpty = sourceHash([
      { path: 'a.md', content: 'alpha' },
      { path: 'b.md', content: '' },
    ]);
    expect(withMissing).toBe(bothEmpty);
  });

  it('separates source boundaries: one document is not two (R-03)', () => {
    const single = sourceHash([{ path: 'a.md', content: 'alpha\nbeta' }]);
    const split = sourceHash([
      { path: 'a.md', content: 'alpha' },
      { path: 'b.md', content: 'beta' },
    ]);
    expect(single).not.toBe(split);
  });

  it('distinguishes an absent source from an extra empty one', () => {
    const one = sourceHash([{ path: 'a.md', content: 'alpha' }]);
    const two = sourceHash([
      { path: 'a.md', content: 'alpha' },
      { path: 'b.md', content: '' },
    ]);
    expect(one).not.toBe(two);
  });

  it('sha256 is stable and hex', () => {
    expect(sha256('x')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256('x')).toBe(sha256('x'));
  });
});
