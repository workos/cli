import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_SDK_TARGET, AGENT_SDK_VERSION } from '../generated/agent-sdk-manifest.js';
import { makeTarball } from './__test-helpers__/npm-tarball-fixtures.js';
import {
  downloadTarball,
  ensureClaudeCodeExecutable,
  extractTarEntry,
  isBunVirtualFsUrl,
} from './agent-sdk-assets.js';

describe('isBunVirtualFsUrl', () => {
  it('detects the POSIX compiled-binary virtual filesystem', () => {
    expect(isBunVirtualFsUrl('file:///$bunfs/root/workos')).toBe(true);
  });

  it('detects the Windows virtual filesystem with the tilde percent-encoded', () => {
    expect(isBunVirtualFsUrl('file:///B:/%7EBUN/root/workos-windows-x64.exe')).toBe(true);
  });

  it('detects a raw Windows virtual path', () => {
    expect(isBunVirtualFsUrl('B:\\~BUN\\root\\workos-windows-x64.exe')).toBe(true);
  });

  it('rejects source-mode module URLs', () => {
    expect(isBunVirtualFsUrl(import.meta.url)).toBe(false);
    expect(isBunVirtualFsUrl('file:///home/dev/cli/src/lib/agent-sdk-assets.ts')).toBe(false);
  });
});

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
  // Extraction itself is covered by npm-tarball.spec.ts; this pins the
  // size-capped wrapper the Agent SDK download path uses.
  it('extracts the named entry from a gzipped tarball', () => {
    const content = Buffer.from('#!/bin/sh\necho claude\n');
    const tarball = makeTarball([
      ['package/package.json', Buffer.from('{}')],
      ['package/claude', content],
    ]);
    expect(extractTarEntry(tarball, 'package/claude').equals(content)).toBe(true);
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

  it('fires onRetry once before the second attempt', async () => {
    const tarball = makeTarball([['package/claude', Buffer.from('binary')]]);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(streamedResponse(tarball));
    vi.stubGlobal('fetch', fetchMock);
    const onRetry = vi.fn();

    await downloadTarball(undefined, undefined, onRetry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not fire onRetry when the first attempt succeeds', async () => {
    const tarball = makeTarball([['package/claude', Buffer.from('binary')]]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(streamedResponse(tarball)));
    const onRetry = vi.fn();

    await downloadTarball(undefined, undefined, onRetry);
    expect(onRetry).not.toHaveBeenCalled();
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
