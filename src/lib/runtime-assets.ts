import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { maxSatisfying, satisfies, valid } from 'semver';
import { RUNTIME_DEPS, type RuntimeDepManifestEntry, type RuntimeDepName } from '../generated/runtime-deps-manifest.js';
import { logWarn } from '../utils/debug.js';
import { isCompiledBinary } from './agent-sdk-assets.js';
import { extractTarEntry } from './npm-tarball.js';

/**
 * Runtime-downloadable dependency bundles.
 *
 * Like the Agent SDK executable (agent-sdk-assets.ts), this is a deliberate
 * exception to the "runtime assets must be statically imported or materialized
 * from the compiled binary" rule: packages such as @workos/migrations and
 * @workos/emulate ship fixes independently of CLI releases, so the compiled
 * binary prefers a downloaded, integrity-verified bundle of the newest version
 * inside a baked semver range and falls back to the compiled-in module
 * whenever anything goes wrong.
 *
 * Flow per dependency (see loadRuntimeBundle):
 *  1. resolve the newest non-deprecated version in range from the npm registry
 *     (abbreviated metadata, cached on disk for 24h),
 *  2. download the version's tarball, verify its SRI sha512 integrity BEFORE
 *     extracting anything, extract the manifest's files (the ESM bundle plus
 *     any sidecars it resolves relative to itself, like migrations' worker.js),
 *     and install them atomically under ~/.workos/cache/<name>/<version>/,
 *  3. dynamic-import the cached bundle entrypoint.
 *
 * Failure at any stage is silent-but-debuggable (logged via logWarn, like
 * version-check.ts) and leaves the caller on the compiled-in module.
 * WORKOS_RUNTIME_DEPS=0 is the kill switch: compiled-in only, no network and
 * no cache reads. When running from source the mechanism is off by default —
 * node_modules already has the packages — and WORKOS_RUNTIME_DEPS=1 forces it
 * on for testing.
 */

const REGISTRY_BASE_URL = 'https://registry.npmjs.org';
/** Registry metadata is a small JSON document; keep the budget tight so cold starts never hang. */
const METADATA_TIMEOUT_MS = 3_000;
/** Bundle tarballs can be tens of MB; downloaded at most once per version. */
const TARBALL_TIMEOUT_MS = 30_000;
const RESOLUTION_TTL_MS = 24 * 60 * 60 * 1000;
/** Generous gzip-bomb cap for JS bundle files (see npm-tarball.ts). */
const MAX_BUNDLE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const RESOLUTION_FILENAME = 'resolution.json';

/** A manifest entry plus its cache-directory name. Exported for tests. */
export type RuntimeDep = RuntimeDepManifestEntry & { name: string };

type ResolvedVersion = {
  version: string;
  tarballUrl: string;
  integrity: string;
};

type ResolutionCache = ResolvedVersion & { fetchedAt: number };

/** Shape of the npm registry's abbreviated ("install") package metadata. */
export type AbbreviatedPackument = {
  versions?: Record<
    string,
    | {
        deprecated?: unknown;
        dist?: { tarball?: unknown; integrity?: unknown };
      }
    | undefined
  >;
};

export type LoadRuntimeBundleOptions = {
  /** Cache root override for tests. Defaults to ~/.workos/cache. @internal */
  cacheRoot?: string;
};

/**
 * Pick the highest non-deprecated version satisfying `range` from abbreviated
 * registry metadata. Returns null when nothing usable satisfies the range
 * (including versions missing a tarball URL or sha512 integrity — those could
 * never be verified, so they are never candidates). Exported for tests.
 */
export function pickHighestSatisfying(metadata: AbbreviatedPackument, range: string): ResolvedVersion | null {
  const versions = metadata.versions ?? {};
  const candidates = Object.keys(versions).filter((version) => {
    const info = versions[version];
    return (
      valid(version) !== null &&
      !info?.deprecated &&
      typeof info?.dist?.tarball === 'string' &&
      typeof info?.dist?.integrity === 'string'
    );
  });
  const version = maxSatisfying(candidates, range);
  if (!version) return null;
  const dist = versions[version]?.dist as { tarball: string; integrity: string };
  return { version, tarballUrl: dist.tarball, integrity: dist.integrity };
}

/**
 * Verify npm's SRI integrity string (sha512 over the raw tarball bytes).
 * Throws on mismatch or when no sha512 hash is present — weaker algorithms
 * (old sha1-only packages) are treated as unverifiable. Exported for tests.
 */
export function verifySriIntegrity(data: Buffer, integrity: string): void {
  const sha512Digests = integrity
    .split(/\s+/)
    .map((entry) => /^sha512-([A-Za-z0-9+/=]+)$/.exec(entry)?.[1])
    .filter((digest): digest is string => digest !== undefined);
  if (sha512Digests.length === 0) {
    throw new Error(`No sha512 hash in integrity string ${JSON.stringify(integrity)}`);
  }
  const actual = createHash('sha512').update(data).digest('base64');
  if (!sha512Digests.includes(actual)) {
    throw new Error(`Integrity mismatch: expected ${integrity}, got sha512-${actual}`);
  }
}

function defaultCacheRoot(): string {
  return join(homedir(), '.workos', 'cache');
}

/**
 * On-disk name for an extracted file. Files are flattened to their basename —
 * all of a dep's files ship in the same tarball directory, so `__dirname`
 * -relative sidecar resolution (migrations' worker.js) keeps working. The
 * entrypoint is renamed .js → .mjs so both Bun (compiled binary) and Node
 * (vitest) unambiguously parse it as ESM without a package.json in the cache
 * dir; sidecars keep their exact basename because the bundle looks them up by
 * that name at runtime.
 */
function installedFileName(tarballPath: string, isEntry: boolean): string {
  const base = basename(tarballPath);
  return isEntry ? base.replace(/\.js$/, '.mjs') : base;
}

function entryPath(cacheDir: string, version: string, dep: RuntimeDep): string {
  return join(cacheDir, version, installedFileName(dep.files[0], true));
}

function readResolutionCache(cacheDir: string, range: string): ResolvedVersion | null {
  try {
    const parsed = JSON.parse(readFileSync(join(cacheDir, RESOLUTION_FILENAME), 'utf8')) as Partial<ResolutionCache>;
    if (
      typeof parsed.version !== 'string' ||
      typeof parsed.tarballUrl !== 'string' ||
      typeof parsed.integrity !== 'string' ||
      typeof parsed.fetchedAt !== 'number'
    ) {
      return null;
    }
    const age = Date.now() - parsed.fetchedAt;
    // A negative age means the clock rolled back under a future timestamp;
    // treat it as stale rather than trusting it forever.
    if (age < 0 || age >= RESOLUTION_TTL_MS) return null;
    // The baked range may have moved since the resolution was cached (CLI update).
    if (valid(parsed.version) === null || !satisfies(parsed.version, range)) return null;
    return { version: parsed.version, tarballUrl: parsed.tarballUrl, integrity: parsed.integrity };
  } catch {
    return null;
  }
}

function writeResolutionCache(cacheDir: string, resolved: ResolvedVersion): void {
  // Best-effort: a failed cache write only costs a refetch next run.
  try {
    mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    const path = join(cacheDir, RESOLUTION_FILENAME);
    const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
    writeFileSync(temporary, JSON.stringify({ ...resolved, fetchedAt: Date.now() } satisfies ResolutionCache));
    renameSync(temporary, path);
  } catch {
    // Ignored.
  }
}

async function fetchResolution(dep: RuntimeDep): Promise<ResolvedVersion> {
  const response = await fetch(`${REGISTRY_BASE_URL}/${encodeURIComponent(dep.npmPackage)}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${dep.npmPackage} metadata`);
  }
  const metadata = (await response.json()) as AbbreviatedPackument;
  const resolved = pickHighestSatisfying(metadata, dep.range);
  if (!resolved) {
    throw new Error(`No non-deprecated ${dep.npmPackage} version satisfies ${dep.range}`);
  }
  return resolved;
}

/** Write-to-temp + rename; a concurrent winner is accepted (its bytes passed the same verification). */
function atomicWriteFile(path: string, bytes: Buffer): void {
  const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(temporary, bytes);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    if (!existsSync(path)) throw error;
  }
}

/**
 * Download the resolved tarball, verify its integrity before extracting, and
 * install the dep's files into the version dir. The entrypoint is written
 * LAST: its presence marks the version dir complete, so a crash mid-install
 * can never leave an importable entrypoint missing its sidecars.
 */
async function downloadBundle(dep: RuntimeDep, resolved: ResolvedVersion, versionDir: string): Promise<void> {
  const response = await fetch(resolved.tarballUrl, { signal: AbortSignal.timeout(TARBALL_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading ${resolved.tarballUrl}`);
  }
  const tarball = Buffer.from(await response.arrayBuffer());
  // Verify BEFORE extracting; nothing unverified is ever written to the cache.
  // The tarball-wide sha512 covers every extracted file in one check.
  verifySriIntegrity(tarball, resolved.integrity);
  // Extract everything up front so a missing entry aborts before any writes.
  const extracted = dep.files.map((file, index) => ({
    // npm tarballs prefix all entries with `package/`.
    bytes: extractTarEntry(tarball, `package/${file}`, MAX_BUNDLE_UNCOMPRESSED_BYTES),
    installedName: installedFileName(file, index === 0),
    isEntry: index === 0,
  }));

  mkdirSync(versionDir, { recursive: true, mode: 0o700 });
  for (const file of [...extracted.filter((f) => !f.isEntry), ...extracted.filter((f) => f.isEntry)]) {
    atomicWriteFile(join(versionDir, file.installedName), file.bytes);
  }
}

// Only reap version dirs untouched for this long — a fresh sibling may belong
// to a concurrently running other-version CLI. Mirrors agent-sdk-assets.ts.
const STALE_VERSION_MS = 24 * 60 * 60 * 1000;

/** Best-effort reap of superseded version dirs after a successful install. */
function cleanupStaleVersions(cacheDir: string, currentVersion: string): void {
  let entries: string[];
  try {
    entries = readdirSync(cacheDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_VERSION_MS;
  for (const entry of entries) {
    // Only semver-named version dirs; never resolution.json or temp files.
    if (entry === currentVersion || valid(entry) === null) continue;
    const path = join(cacheDir, entry);
    try {
      if (statSync(path).mtimeMs >= cutoff) continue;
      rmSync(path, { recursive: true, force: true });
    } catch {
      // In use, already gone, or unreadable — skip it.
    }
  }
}

/** Newest already-downloaded version inside the baked range, for offline runs. */
function newestDownloadedVersion(cacheDir: string, dep: RuntimeDep): string | null {
  let entries: string[];
  try {
    entries = readdirSync(cacheDir);
  } catch {
    return null;
  }
  const candidates = entries.filter(
    (entry) => valid(entry) !== null && satisfies(entry, dep.range) && existsSync(entryPath(cacheDir, entry, dep)),
  );
  return maxSatisfying(candidates, dep.range);
}

async function importBundle(bundlePath: string): Promise<Record<string, unknown>> {
  // Runtime-computed dynamic import: Bun leaves this as a real runtime import
  // in compiled binaries (verified on Bun 1.3.11), so the cached bundle loads
  // from outside the binary's virtual filesystem.
  return (await import(pathToFileURL(bundlePath).href)) as Record<string, unknown>;
}

/**
 * Core loader, parameterized by dep so tests can drive it with fixtures.
 * Returns the imported bundle's module namespace, or null when the caller
 * should use the compiled-in module instead. Never throws. Exported for tests
 * — production callers go through loadRuntimeBundle.
 */
export async function loadRuntimeDep(
  dep: RuntimeDep,
  options: LoadRuntimeBundleOptions = {},
): Promise<Record<string, unknown> | null> {
  const setting = process.env.WORKOS_RUNTIME_DEPS;
  // Kill switch: compiled-in only, no network, no cache reads.
  if (setting === '0') return null;
  // Running from source (dev, tests, evals): node_modules already provides the
  // packages, so stay off the network unless explicitly forced on.
  if (!isCompiledBinary() && setting !== '1') return null;

  const cacheDir = join(options.cacheRoot ?? defaultCacheRoot(), dep.name);
  try {
    let resolved = readResolutionCache(cacheDir, dep.range);
    if (!resolved) {
      try {
        resolved = await fetchResolution(dep);
        writeResolutionCache(cacheDir, resolved);
      } catch (error) {
        logWarn(`Version resolution for runtime dep ${dep.npmPackage} failed:`, error);
        resolved = null;
      }
    }

    if (resolved) {
      try {
        const bundlePath = entryPath(cacheDir, resolved.version, dep);
        if (!existsSync(bundlePath)) {
          await downloadBundle(dep, resolved, join(cacheDir, resolved.version));
          cleanupStaleVersions(cacheDir, resolved.version);
        }
        return await importBundle(bundlePath);
      } catch (error) {
        logWarn(`Runtime bundle install for ${dep.npmPackage}@${resolved.version} failed:`, error);
      }
    }

    // Resolution or install failed — the newest previously downloaded version
    // (verified when it was installed) still works offline.
    const fallback = newestDownloadedVersion(cacheDir, dep);
    if (!fallback) return null;
    return await importBundle(entryPath(cacheDir, fallback, dep));
  } catch (error) {
    logWarn(`Runtime bundle for ${dep.npmPackage} unavailable; using the compiled-in module:`, error);
    return null;
  }
}

const moduleCache = new Map<RuntimeDepName, Record<string, unknown> | null>();

/** @internal */
export function _resetRuntimeAssetsForTesting(): void {
  moduleCache.clear();
}

/**
 * Load the runtime-downloaded bundle for a manifest dep, memoized per process.
 * Returns null whenever the compiled-in module should be used instead; callers
 * validate the export shape they need and fall back themselves, keeping the
 * compiled-in types as the compile-time contract.
 */
export async function loadRuntimeBundle(
  name: RuntimeDepName,
  options: LoadRuntimeBundleOptions = {},
): Promise<Record<string, unknown> | null> {
  const cached = moduleCache.get(name);
  if (cached !== undefined) return cached;
  const loaded = await loadRuntimeDep({ ...RUNTIME_DEPS[name], name }, options);
  moduleCache.set(name, loaded);
  return loaded;
}
