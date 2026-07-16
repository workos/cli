import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { AGENT_SDK_TARGET, AGENT_SDK_VERSION } from '../generated/agent-sdk-manifest.js';
import { ensureClaudeCodeExecutable, extractTarEntry } from './agent-sdk-assets.js';

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'utf8');
  header.write('0', 156, 'utf8'); // typeflag: regular file
  header.write('ustar\0', 257, 'utf8');
  header.write('00', 263, 'utf8');
  header.fill(' ', 148, 156); // checksum field counts as spaces while summing
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'utf8');
  return header;
}

function makeTarball(entries: Array<[string, Buffer]>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, content] of entries) {
    parts.push(tarHeader(name, content.length), content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024)); // end-of-archive
  return gzipSync(Buffer.concat(parts));
}

describe('ensureClaudeCodeExecutable', () => {
  it('resolves the current platform executable from node_modules in source mode', async () => {
    expect(AGENT_SDK_TARGET).toBe(`${process.platform}-${process.arch}`);
    expect(AGENT_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    const path = await ensureClaudeCodeExecutable();
    expect(existsSync(path)).toBe(true);
    expect(path).toContain('node_modules');
  });
});

describe('extractTarEntry', () => {
  it('extracts the named entry from a gzipped tarball', () => {
    const content = Buffer.from('#!/bin/sh\necho claude\n');
    const tarball = makeTarball([
      ['package/package.json', Buffer.from('{}')],
      ['package/claude', content],
    ]);
    expect(extractTarEntry(tarball, 'package/claude').equals(content)).toBe(true);
  });

  it('handles entries whose size is an exact block multiple', () => {
    const content = Buffer.alloc(1024, 7);
    const tarball = makeTarball([
      ['package/claude', content],
      ['package/LICENSE.md', Buffer.from('license')],
    ]);
    expect(extractTarEntry(tarball, 'package/LICENSE.md').toString()).toBe('license');
  });

  it('throws when the entry is missing', () => {
    const tarball = makeTarball([['package/package.json', Buffer.from('{}')]]);
    expect(() => extractTarEntry(tarball, 'package/claude')).toThrow(/not found/);
  });
});
