import { describe, expect, it } from 'vitest';
import { makeTarball } from './__test-helpers__/npm-tarball-fixtures.js';
import { extractTarEntry } from './npm-tarball.js';

const MAX_BYTES = 64 * 1024 * 1024;

describe('extractTarEntry', () => {
  it('extracts the named entry from a gzipped tarball', () => {
    const content = Buffer.from('#!/bin/sh\necho claude\n');
    const tarball = makeTarball([
      ['package/package.json', Buffer.from('{}')],
      ['package/claude', content],
    ]);
    expect(extractTarEntry(tarball, 'package/claude', MAX_BYTES).equals(content)).toBe(true);
  });

  it('handles entries whose size is an exact block multiple', () => {
    const content = Buffer.alloc(1024, 7);
    const tarball = makeTarball([
      ['package/claude', content],
      ['package/LICENSE.md', Buffer.from('license')],
    ]);
    expect(extractTarEntry(tarball, 'package/LICENSE.md', MAX_BYTES).toString()).toBe('license');
  });

  it('throws when the entry is missing', () => {
    const tarball = makeTarball([['package/package.json', Buffer.from('{}')]]);
    expect(() => extractTarEntry(tarball, 'package/claude', MAX_BYTES)).toThrow(/not found/);
  });

  it('refuses to decompress past the gzip-bomb cap', () => {
    const tarball = makeTarball([['package/big', Buffer.alloc(64 * 1024)]]);
    expect(() => extractTarEntry(tarball, 'package/big', 4 * 1024)).toThrow();
  });
});
