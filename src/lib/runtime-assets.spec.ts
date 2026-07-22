import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTarball } from './__test-helpers__/npm-tarball-fixtures.js';
import {
  loadRuntimeDep,
  pickHighestSatisfying,
  verifySriIntegrity,
  type AbbreviatedPackument,
  type RuntimeDep,
} from './runtime-assets.js';

const DEP: RuntimeDep = {
  name: 'test-dep',
  npmPackage: '@workos/test-dep',
  range: '^1.0.0',
  files: ['dist/bundle.js'],
};

function sri(data: Buffer): string {
  return `sha512-${createHash('sha512').update(data).digest('base64')}`;
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function bytesResponse(body: Buffer): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response;
}

/** Abbreviated packument with per-version dist info defaulted. */
function metadata(
  versions: Record<string, { deprecated?: string; tarballUrl?: string; integrity?: string }>,
): AbbreviatedPackument {
  return {
    versions: Object.fromEntries(
      Object.entries(versions).map(([version, info]) => [
        version,
        {
          ...(info.deprecated === undefined ? {} : { deprecated: info.deprecated }),
          dist: {
            tarball: info.tarballUrl ?? `https://registry.npmjs.org/@workos/test-dep/-/test-dep-${version}.tgz`,
            integrity: info.integrity ?? `sha512-${'A'.repeat(86)}==`,
          },
        },
      ]),
    ),
  };
}

describe('pickHighestSatisfying', () => {
  it('picks the highest version inside the range, ignoring newer out-of-range ones', () => {
    const resolved = pickHighestSatisfying(metadata({ '1.0.0': {}, '1.4.0': {}, '2.0.0': {} }), '^1.0.0');
    expect(resolved?.version).toBe('1.4.0');
    expect(resolved?.tarballUrl).toContain('test-dep-1.4.0.tgz');
  });

  it('skips deprecated versions', () => {
    const resolved = pickHighestSatisfying(
      metadata({ '1.0.0': {}, '1.4.0': { deprecated: 'broken release' } }),
      '^1.0.0',
    );
    expect(resolved?.version).toBe('1.0.0');
  });

  it('skips versions without a sha512 integrity or tarball URL', () => {
    const withoutDist: AbbreviatedPackument = {
      versions: {
        '1.0.0': { dist: { tarball: 'https://example.invalid/1.0.0.tgz', integrity: 'sha512-x' } },
        '1.5.0': { dist: {} },
      },
    };
    expect(pickHighestSatisfying(withoutDist, '^1.0.0')?.version).toBe('1.0.0');
  });

  it('returns null when nothing satisfies the range', () => {
    expect(pickHighestSatisfying(metadata({ '2.0.0': {} }), '^1.0.0')).toBeNull();
  });
});

describe('verifySriIntegrity', () => {
  const data = Buffer.from('runtime bundle bytes');

  it('accepts a matching sha512 digest', () => {
    expect(() => verifySriIntegrity(data, sri(data))).not.toThrow();
  });

  it('throws on a digest mismatch', () => {
    expect(() => verifySriIntegrity(data, sri(Buffer.from('other bytes')))).toThrow(/Integrity mismatch/);
  });

  it('rejects integrity strings without a sha512 hash', () => {
    expect(() => verifySriIntegrity(data, 'sha1-2jmj7l5rSw0yVb/vlWAYkK/YBwk=')).toThrow(/No sha512/);
  });
});

describe('loadRuntimeDep', () => {
  let cacheRoot: string;

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'workos-runtime-assets-'));
    // Vitest runs from source, where the mechanism is off by default; force it
    // on the way a compiled binary has it.
    vi.stubEnv('WORKOS_RUNTIME_DEPS', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  function seedInstalledVersion(version: string, marker: string): void {
    const versionDir = join(cacheRoot, DEP.name, version);
    mkdirSync(versionDir, { recursive: true });
    writeFileSync(join(versionDir, 'bundle.mjs'), `export const marker = ${JSON.stringify(marker)};\n`);
  }

  function seedResolution(resolution: Record<string, unknown>): void {
    const depDir = join(cacheRoot, DEP.name);
    mkdirSync(depDir, { recursive: true });
    writeFileSync(join(depDir, 'resolution.json'), JSON.stringify(resolution));
  }

  it('resolves the highest in-range version, downloads, verifies, and imports the bundle', async () => {
    const tarball = makeTarball([['package/dist/bundle.js', Buffer.from('export const marker = "v1.4.0";\n')]]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(metadata({ '1.0.0': {}, '1.4.0': { integrity: sri(tarball) }, '2.0.0': {} })))
      .mockResolvedValueOnce(bytesResponse(tarball));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await loadRuntimeDep(DEP, { cacheRoot });

    expect(mod?.marker).toBe('v1.4.0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [metadataUrl, metadataInit] = fetchMock.mock.calls[0];
    expect(metadataUrl).toBe('https://registry.npmjs.org/%40workos%2Ftest-dep');
    expect(metadataInit.headers.accept).toBe('application/vnd.npm.install-v1+json');
    expect(existsSync(join(cacheRoot, 'test-dep', '1.4.0', 'bundle.mjs'))).toBe(true);
    const resolution = JSON.parse(readFileSync(join(cacheRoot, 'test-dep', 'resolution.json'), 'utf8'));
    expect(resolution.version).toBe('1.4.0');
  });

  it('installs sidecar files next to the entrypoint (migrations worker contract)', async () => {
    const twoFileDep: RuntimeDep = { ...DEP, files: ['dist/bundle.js', 'dist/worker.js'] };
    const tarball = makeTarball([
      ['package/dist/bundle.js', Buffer.from('export const marker = "with-worker";\n')],
      ['package/dist/worker.js', Buffer.from('// worker thread code\n')],
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(metadata({ '1.4.0': { integrity: sri(tarball) } })))
      .mockResolvedValueOnce(bytesResponse(tarball));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await loadRuntimeDep(twoFileDep, { cacheRoot });

    expect(mod?.marker).toBe('with-worker');
    const versionDir = join(cacheRoot, 'test-dep', '1.4.0');
    // The sidecar keeps its exact basename, co-located with the imported entrypoint.
    expect(existsSync(join(versionDir, 'worker.js'))).toBe(true);
    expect(existsSync(join(versionDir, 'bundle.mjs'))).toBe(true);
  });

  it('rejects a tarball that fails integrity verification and does not install it', async () => {
    const tarball = makeTarball([['package/dist/bundle.js', Buffer.from('export const marker = "tampered";\n')]]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(metadata({ '1.4.0': { integrity: `sha512-${'A'.repeat(86)}==` } })))
      .mockResolvedValueOnce(bytesResponse(tarball));
    vi.stubGlobal('fetch', fetchMock);

    expect(await loadRuntimeDep(DEP, { cacheRoot })).toBeNull();
    expect(existsSync(join(cacheRoot, 'test-dep', '1.4.0'))).toBe(false);
  });

  it('honors the resolution TTL: no metadata refetch while the cache is fresh', async () => {
    seedInstalledVersion('1.2.3', 'cached');
    seedResolution({
      version: '1.2.3',
      tarballUrl: 'https://example.invalid/never-fetched.tgz',
      integrity: 'sha512-never-checked',
      fetchedAt: Date.now(),
    });
    const fetchMock = vi.fn().mockRejectedValue(new Error('network must not be touched'));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await loadRuntimeDep(DEP, { cacheRoot });

    expect(mod?.marker).toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refetches metadata once the resolution cache is past its TTL', async () => {
    seedInstalledVersion('1.2.3', 'stale');
    seedResolution({
      version: '1.2.3',
      tarballUrl: 'https://example.invalid/old.tgz',
      integrity: 'sha512-old',
      fetchedAt: Date.now() - 25 * 60 * 60 * 1000,
    });
    const tarball = makeTarball([['package/dist/bundle.js', Buffer.from('export const marker = "v1.5.0";\n')]]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(metadata({ '1.5.0': { integrity: sri(tarball) } })))
      .mockResolvedValueOnce(bytesResponse(tarball));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await loadRuntimeDep(DEP, { cacheRoot });

    expect(mod?.marker).toBe('v1.5.0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const resolution = JSON.parse(readFileSync(join(cacheRoot, 'test-dep', 'resolution.json'), 'utf8'));
    expect(resolution.version).toBe('1.5.0');
  });

  it('falls back to the newest downloaded in-range version when the registry is unreachable', async () => {
    seedInstalledVersion('1.1.0', 'older');
    seedInstalledVersion('1.3.0', 'newest-in-range');
    seedInstalledVersion('2.0.0', 'out-of-range');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const mod = await loadRuntimeDep(DEP, { cacheRoot });

    expect(mod?.marker).toBe('newest-in-range');
  });

  it('returns null when offline with nothing cached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    expect(await loadRuntimeDep(DEP, { cacheRoot })).toBeNull();
  });

  it('falls back to a previously downloaded version when the new download fails', async () => {
    seedInstalledVersion('1.1.0', 'previously-verified');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(metadata({ '1.6.0': {} })))
      .mockRejectedValueOnce(new Error('tarball download failed'));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await loadRuntimeDep(DEP, { cacheRoot });

    expect(mod?.marker).toBe('previously-verified');
  });

  it('does nothing at all when WORKOS_RUNTIME_DEPS=0', async () => {
    vi.stubEnv('WORKOS_RUNTIME_DEPS', '0');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    seedInstalledVersion('1.3.0', 'must-not-load');

    expect(await loadRuntimeDep(DEP, { cacheRoot })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays on the compiled-in module by default when running from source', async () => {
    vi.stubEnv('WORKOS_RUNTIME_DEPS', undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await loadRuntimeDep(DEP, { cacheRoot })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
