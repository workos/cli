import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_SDK_TARGET, AGENT_SDK_VERSION } from '../generated/agent-sdk-manifest.js';
import { downloadTarball, ensureClaudeCodeExecutable, extractTarEntry } from './agent-sdk-assets.js';

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

describe('downloadTarball', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function streamedResponse(body: Buffer): Response {
    let sent = false;
    return {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'content-length' ? String(body.length) : null) },
      body: {
        getReader() {
          return {
            read: async () =>
              sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: new Uint8Array(body) }),
          };
        },
      },
    } as unknown as Response;
  }

  it('retries once when the first attempt fails, then succeeds', async () => {
    const tarball = makeTarball([['package/claude', Buffer.from('binary')]]);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(streamedResponse(tarball));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadTarball();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.equals(tarball)).toBe(true);
  });

  it('aborts a stalled download and reports it after retrying', async () => {
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
          getReader() {
            return {
              read: () =>
                new Promise((_resolve, reject) => {
                  init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                }),
            };
          },
        },
      } as unknown as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadTarball(undefined, 20)).rejects.toThrow(/stalled/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
