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
  bundledVersion: '1.0.0',
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
    const resolved = pickHighestSatisfying(metadata({ '1.0.0': {}, '1.4.0': {}, '2.0.0': {} }), DEP);
    expect(resolved?.version).toBe('1.4.0');
    expect(resolved?.tarballUrl).toContain('test-dep-1.4.0.tgz');
  });

  it('skips deprecated versions', () => {
    const resolved = pickHighestSatisfying(metadata({ '1.1.0': {}, '1.4.0': { deprecated: 'broken release' } }), DEP);
    expect(resolved?.version).toBe('1.1.0');
  });

  it('skips versions without a sha512 integrity or tarball URL', () => {
    const withoutDist: AbbreviatedPackument = {
      versions: {
        '1.1.0': { dist: { tarball: 'https://example.invalid/1.1.0.tgz', integrity: 'sha512-x' } },
        '1.5.0': { dist: {} },
        '1.6.0': {
          dist: { tarball: 'https://example.invalid/1.6.0.tgz', integrity: 'sha1-2jmj7l5rSw0yVb/vlWAYkK/YBwk=' },
        },
      },
    };
    expect(pickHighestSatisfying(withoutDist, DEP)?.version).toBe('1.1.0');
  });

  it('returns null when nothing satisfies the range', () => {
    expect(pickHighestSatisfying(metadata({ '2.0.0': {} }), DEP)).toBeNull();
  });

  it('returns null when nothing is newer than the compiled-in version', () => {
    // The newest in-range release is what this binary already ships: downloading
    // it would be a wasted tarball at best and, from a shared cache, a downgrade
    // at worst.
    const registry = metadata({ '1.0.0': {}, '1.2.0': {} });
    expect(pickHighestSatisfying(registry, { ...DEP, bundledVersion: '1.2.0' })).toBeNull();
    expect(pickHighestSatisfying(registry, { ...DEP, bundledVersion: '1.1.0' })?.version).toBe('1.2.0');
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

  function versionDir(version: string): string {
    return join(cacheRoot, DEP.name, version);
  }

  function seedInstalledVersion(version: string, marker: string): void {
    mkdirSync(versionDir(version), { recursive: true });
    writeFileSync(join(versionDir(version), 'bundle.mjs'), `export const marker = ${JSON.stringify(marker)};\n`);
  }

  /** A complete-looking install whose bundle throws on import (truncated, incompatible, ...). */
  function seedBrokenVersion(version: string): void {
    mkdirSync(versionDir(version), { recursive: true });
    writeFileSync(
      join(versionDir(version), 'bundle.mjs'),
      `throw new Error(${JSON.stringify(`broken ${version}`)});\n`,
    );
  }

  function resolvedVersion(version: string): Record<string, string> {
    return { version, tarballUrl: `https://example.invalid/${version}.tgz`, integrity: 'sha512-never-checked' };
  }

  /** resolution.json as this CLI build would have written it, with overrides. */
  function seedResolution(entry: Record<string, unknown>): void {
    mkdirSync(join(cacheRoot, DEP.name), { recursive: true });
    writeFileSync(
      join(cacheRoot, DEP.name, 'resolution.json'),
      JSON.stringify({
        fetchedAt: Date.now(),
        range: DEP.range,
        bundledVersion: DEP.bundledVersion,
        installFailed: false,
        ...entry,
      }),
    );
  }

  function readResolution(): Record<string, unknown> {
    return JSON.parse(readFileSync(join(cacheRoot, DEP.name, 'resolution.json'), 'utf8'));
  }

  /** Every fetch rejects — the registry is unreachable, or must not be touched at all. */
  function stubFetchRejecting(reason: string): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockRejectedValue(new Error(reason));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
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
    expect(existsSync(join(versionDir('1.4.0'), 'bundle.mjs'))).toBe(true);
    expect(readResolution()).toMatchObject({
      resolved: { version: '1.4.0' },
      installFailed: false,
      range: '^1.0.0',
      bundledVersion: '1.0.0',
    });
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
    // The sidecar keeps its exact basename, co-located with the imported entrypoint.
    expect(existsSync(join(versionDir('1.4.0'), 'worker.js'))).toBe(true);
    expect(existsSync(join(versionDir('1.4.0'), 'bundle.mjs'))).toBe(true);
  });

  it('rejects a tarball that fails integrity verification and does not install it', async () => {
    const tarball = makeTarball([['package/dist/bundle.js', Buffer.from('export const marker = "tampered";\n')]]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(metadata({ '1.4.0': { integrity: `sha512-${'A'.repeat(86)}==` } })))
      .mockResolvedValueOnce(bytesResponse(tarball));
    vi.stubGlobal('fetch', fetchMock);

    expect(await loadRuntimeDep(DEP, { cacheRoot })).toBeNull();
    expect(existsSync(versionDir('1.4.0'))).toBe(false);
  });

  it('honors the resolution TTL: no metadata refetch while the cache is fresh', async () => {
    seedInstalledVersion('1.2.3', 'cached');
    seedResolution({ resolved: resolvedVersion('1.2.3') });
    const fetchMock = stubFetchRejecting('network must not be touched');

    const mod = await loadRuntimeDep(DEP, { cacheRoot });

    expect(mod?.marker).toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refetches metadata once the resolution cache is past its TTL', async () => {
    seedInstalledVersion('1.2.3', 'stale');
    seedResolution({ resolved: resolvedVersion('1.2.3'), fetchedAt: Date.now() - 25 * 60 * 60 * 1000 });
    const tarball = makeTarball([['package/dist/bundle.js', Buffer.from('export const marker = "v1.5.0";\n')]]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(metadata({ '1.5.0': { integrity: sri(tarball) } })))
      .mockResolvedValueOnce(bytesResponse(tarball));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await loadRuntimeDep(DEP, { cacheRoot });

    expect(mod?.marker).toBe('v1.5.0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readResolution()).toMatchObject({ resolved: { version: '1.5.0' } });
  });

  it('remembers that nothing newer than the compiled-in version exists, without re-querying inside the TTL', async () => {
    // Steady state for an up-to-date CLI: the registry's newest in-range
    // release is the one compiled in. No tarball is fetched, and the verdict
    // is cached like any other resolution.
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(metadata({ '1.0.0': {} })));
    vi.stubGlobal('fetch', fetchMock);

    expect(await loadRuntimeDep(DEP, { cacheRoot })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readResolution()).toMatchObject({ resolved: null, bundledVersion: '1.0.0' });

    const secondFetch = stubFetchRejecting('network must not be touched');

    expect(await loadRuntimeDep(DEP, { cacheRoot })).toBeNull();
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it('never runs a cached bundle that is not newer than the compiled-in module', async () => {
    // The cache dir is shared across CLI installs. An older CLI (compiled-in
    // 1.0.0) resolved, downloaded, and cached 1.2.0 an hour ago...
    seedInstalledVersion('1.2.0', 'downloaded-by-older-cli');
    seedResolution({ resolved: resolvedVersion('1.2.0'), bundledVersion: '1.0.0' });
    // ...and this CLI ships 1.2.0 itself. Its resolution must not be trusted,
    // and the cached 1.2.0 must not be used as a fallback either: running it
    // instead of the compiled-in module gains nothing and a cached 1.1.0 in
    // the same position would be a downgrade.
    const newerCli: RuntimeDep = { ...DEP, bundledVersion: '1.2.0' };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(metadata({ '1.0.0': {}, '1.2.0': {} })));
    vi.stubGlobal('fetch', fetchMock);

    expect(await loadRuntimeDep(newerCli, { cacheRoot })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readResolution()).toMatchObject({ resolved: null, bundledVersion: '1.2.0' });
  });

  it('invalidates the cached resolution when the baked range moves', async () => {
    seedInstalledVersion('1.2.0', 'previous-major');
    seedResolution({ resolved: resolvedVersion('1.2.0') });
    const fetchMock = stubFetchRejecting('offline');

    expect(await loadRuntimeDep({ ...DEP, range: '^2.0.0', bundledVersion: '2.0.0' }, { cacheRoot })).toBeNull();
    // The cache was not trusted (a refetch was attempted) and the out-of-range
    // download was not used as a fallback.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the newest downloaded in-range version when the registry is unreachable', async () => {
    seedInstalledVersion('1.1.0', 'older');
    seedInstalledVersion('1.3.0', 'newest-in-range');
    seedInstalledVersion('2.0.0', 'out-of-range');
    stubFetchRejecting('offline');

    const mod = await loadRuntimeDep(DEP, { cacheRoot });

    expect(mod?.marker).toBe('newest-in-range');
  });

  it('never falls back to a downloaded version that is not newer than the compiled-in one', async () => {
    seedInstalledVersion('1.0.0', 'same-as-compiled-in');
    seedInstalledVersion('1.1.0', 'older-than-compiled-in');
    stubFetchRejecting('offline');

    expect(await loadRuntimeDep({ ...DEP, bundledVersion: '1.2.0' }, { cacheRoot })).toBeNull();
  });

  it('returns null when offline with nothing cached', async () => {
    stubFetchRejecting('offline');

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

  it('does not retry the download within the TTL after an install failure', async () => {
    // Transition-period shape: the published tarball has no bundle entry yet.
    const tarball = makeTarball([['package/README.md', Buffer.from('no bundle here\n')]]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(metadata({ '1.6.0': { integrity: sri(tarball) } })))
      .mockResolvedValueOnce(bytesResponse(tarball));
    vi.stubGlobal('fetch', fetchMock);

    expect(await loadRuntimeDep(DEP, { cacheRoot })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readResolution()).toMatchObject({ resolved: { version: '1.6.0' }, installFailed: true });

    // Next invocation inside the TTL: no metadata refetch, no tarball retry.
    const secondFetch = stubFetchRejecting('network must not be touched');

    expect(await loadRuntimeDep(DEP, { cacheRoot })).toBeNull();
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it('quarantines a downloaded bundle that fails to import and does not retry it within the TTL', async () => {
    const tarball = makeTarball([['package/dist/bundle.js', Buffer.from('throw new Error("broken bundle");\n')]]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(metadata({ '1.6.0': { integrity: sri(tarball) } })))
      .mockResolvedValueOnce(bytesResponse(tarball));
    vi.stubGlobal('fetch', fetchMock);

    expect(await loadRuntimeDep(DEP, { cacheRoot })).toBeNull();
    // The version dir is gone, so neither the fallback nor the next run can
    // trip over it, and the failure is remembered for the TTL.
    expect(existsSync(versionDir('1.6.0'))).toBe(false);
    expect(readResolution()).toMatchObject({ resolved: { version: '1.6.0' }, installFailed: true });

    const secondFetch = stubFetchRejecting('network must not be touched');

    expect(await loadRuntimeDep(DEP, { cacheRoot })).toBeNull();
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it('quarantines a cached bundle that stops importing and falls back to an older downloaded upgrade', async () => {
    // The resolved version installed fine on a previous run but no longer
    // imports; an older upgrade is still on disk.
    seedBrokenVersion('1.3.0');
    seedInstalledVersion('1.1.0', 'older-good');
    seedResolution({ resolved: resolvedVersion('1.3.0') });
    const fetchMock = stubFetchRejecting('network must not be touched');

    expect((await loadRuntimeDep(DEP, { cacheRoot }))?.marker).toBe('older-good');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(versionDir('1.3.0'))).toBe(false);
    expect(readResolution()).toMatchObject({ resolved: { version: '1.3.0' }, installFailed: true });

    // Next run inside the TTL skips the quarantined version outright.
    expect((await loadRuntimeDep(DEP, { cacheRoot }))?.marker).toBe('older-good');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips and removes broken downloaded versions in the offline fallback', async () => {
    seedBrokenVersion('1.3.0');
    seedInstalledVersion('1.1.0', 'older-good');
    stubFetchRejecting('offline');

    expect((await loadRuntimeDep(DEP, { cacheRoot }))?.marker).toBe('older-good');
    expect(existsSync(versionDir('1.3.0'))).toBe(false);
    expect(existsSync(versionDir('1.1.0'))).toBe(true);
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
