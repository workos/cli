import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gt, maxSatisfying, rsort, satisfies, valid } from 'semver';
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
 * Flow per dependency (see loadRuntimeDep):
 *  1. resolve the newest non-deprecated version in range from the npm registry
 *     (abbreviated metadata, cached on disk for 24h). Only versions strictly
 *     newer than the one compiled into this binary count (see isUpgrade): the
 *     cache dir is shared by every CLI install on the machine, so an older
 *     cached bundle must never downgrade a newer CLI, and a current CLI never
 *     re-downloads what it already ships,
 *  2. download the version's tarball, verify its SRI sha512 integrity BEFORE
 *     extracting anything, extract the manifest's files (the ESM bundle plus
 *     any sidecars it resolves relative to itself, like migrations' worker.js),
 *     and install them atomically under ~/.workos/cache/<name>/<version>/,
 *  3. dynamic-import the cached bundle entrypoint.
 *
 * Failure at any stage is silent-but-debuggable (logged via logWarn, like
 * version-check.ts) and leaves the caller on the compiled-in module. A version
 * that fails to install or import is quarantined — its directory is deleted
 * and the failure remembered — so a broken bundle is never retried on every
 * invocation and older downloaded upgrades get their turn as the offline
 * fallback. A tarball or bundle that is actually broken stays quarantined
 * until the resolution TTL expires; a transient download failure (network,
 * timeout, registry 5xx) only for a short backoff, so one blip doesn't cost
 * the upgrade for a day.
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
/**
 * How long a transient download failure keeps its version quarantined. Long
 * enough that a blackholed network costs at most one TARBALL_TIMEOUT_MS stall
 * per window, short enough that the upgrade lands soon after the network
 * recovers rather than after the full resolution TTL.
 */
const TRANSIENT_RETRY_MS = 15 * 60 * 1000;
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

/** Outcome of a registry lookup, as remembered on disk between invocations. */
type Resolution = {
  /** Newest usable upgrade, or null when the registry has nothing newer than the compiled-in version. */
  resolved: ResolvedVersion | null;
  /** `resolved` is quarantined: installing or importing it failed recently enough that it must not be retried yet. */
  installFailed: boolean;
};

type ResolutionCache = {
  fetchedAt: number;
  /** Baked range and compiled-in version the lookup was made against; a CLI update invalidates the entry. */
  range: string;
  bundledVersion: string;
  resolved: ResolvedVersion | null;
  /**
   * Installing `resolved` failed; don't retry before this time. A broken
   * tarball or bundle is quarantined until the entry itself expires (the
   * resolution TTL); a transient download failure only for TRANSIENT_RETRY_MS.
   */
  retryAt?: number;
};

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
 * Whether `version` may run in place of the compiled-in module: inside the
 * baked range AND strictly newer than the compiled-in version. Every version
 * the loader considers — registry candidates, the cached resolution, and
 * downloaded version dirs — passes through this one check, so nothing older
 * than (or equal to) what the binary ships can ever win.
 */
function isUpgrade(version: string, dep: Pick<RuntimeDep, 'range' | 'bundledVersion'>): boolean {
  return valid(version) !== null && satisfies(version, dep.range) && gt(version, dep.bundledVersion);
}

/**
 * Pick the highest non-deprecated upgrade from abbreviated registry metadata
 * (inside `dep.range` and newer than `dep.bundledVersion`). Returns null when
 * there is nothing to upgrade to, which includes versions missing a tarball
 * URL or sha512 integrity — those could never be verified, so they are never
 * candidates. Exported for tests.
 */
export function pickHighestSatisfying(
  metadata: AbbreviatedPackument,
  dep: Pick<RuntimeDep, 'range' | 'bundledVersion'>,
): ResolvedVersion | null {
  const versions = metadata.versions ?? {};
  const candidates = Object.keys(versions).filter((version) => {
    const info = versions[version];
    return (
      isUpgrade(version, dep) &&
      !info?.deprecated &&
      typeof info?.dist?.tarball === 'string' &&
      typeof info?.dist?.integrity === 'string' &&
      sha512Digests(info.dist.integrity).length > 0
    );
  });
  const version = maxSatisfying(candidates, dep.range);
  if (!version) return null;
  const dist = versions[version]?.dist as { tarball: string; integrity: string };
  return { version, tarballUrl: dist.tarball, integrity: dist.integrity };
}

/** The sha512 digests in an SRI integrity string — the only algorithm we verify. */
function sha512Digests(integrity: string): string[] {
  return integrity
    .split(/\s+/)
    .map((entry) => /^sha512-([A-Za-z0-9+/=]+)$/.exec(entry)?.[1])
    .filter((digest): digest is string => digest !== undefined);
}

/**
 * Verify npm's SRI integrity string (sha512 over the raw tarball bytes).
 * Throws on mismatch or when no sha512 hash is present — weaker algorithms
 * (old sha1-only packages) are treated as unverifiable. Exported for tests.
 */
export function verifySriIntegrity(data: Buffer, integrity: string): void {
  const digests = sha512Digests(integrity);
  if (digests.length === 0) {
    throw new Error(`No sha512 hash in integrity string ${JSON.stringify(integrity)}`);
  }
  const actual = createHash('sha512').update(data).digest('base64');
  if (!digests.includes(actual)) {
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

/** The remembered registry lookup, or null when it is missing, stale, or was made for a different CLI build. */
function readResolutionCache(cacheDir: string, dep: RuntimeDep): Resolution | null {
  try {
    const parsed = JSON.parse(readFileSync(join(cacheDir, RESOLUTION_FILENAME), 'utf8')) as Partial<ResolutionCache>;
    if (typeof parsed.fetchedAt !== 'number') return null;
    const now = Date.now();
    const age = now - parsed.fetchedAt;
    // A negative age means the clock rolled back under a future timestamp;
    // treat it as stale rather than trusting it forever.
    if (age < 0 || age >= RESOLUTION_TTL_MS) return null;
    // Looked up by a different CLI build (the baked range or the compiled-in
    // version moved): its verdict says nothing about what this binary needs,
    // and trusting it is how a shared cache downgrades a newer CLI.
    if (parsed.range !== dep.range || parsed.bundledVersion !== dep.bundledVersion) return null;
    if (parsed.resolved === null) return { resolved: null, installFailed: false };
    const resolved = parsed.resolved;
    if (
      typeof resolved?.version !== 'string' ||
      typeof resolved.tarballUrl !== 'string' ||
      typeof resolved.integrity !== 'string' ||
      !isUpgrade(resolved.version, dep)
    ) {
      return null;
    }
    return {
      resolved: { version: resolved.version, tarballUrl: resolved.tarballUrl, integrity: resolved.integrity },
      installFailed: typeof parsed.retryAt === 'number' && now < parsed.retryAt,
    };
  } catch {
    return null;
  }
}

/**
 * Remember a registry lookup. `retryAt` quarantines `resolved` until that
 * time — omit it when the version is fine to install.
 */
function writeResolutionCache(
  cacheDir: string,
  dep: RuntimeDep,
  resolved: ResolvedVersion | null,
  retryAt?: number,
): void {
  // Best-effort: a failed cache write only costs a refetch next run.
  try {
    mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    const path = join(cacheDir, RESOLUTION_FILENAME);
    const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
    const entry: ResolutionCache = {
      fetchedAt: Date.now(),
      range: dep.range,
      bundledVersion: dep.bundledVersion,
      resolved,
      ...(retryAt === undefined ? {} : { retryAt }),
    };
    writeFileSync(temporary, JSON.stringify(entry));
    renameSync(temporary, path);
  } catch {
    // Ignored.
  }
}

/** Registry lookup; null means the registry has nothing newer than the compiled-in version. */
async function fetchResolution(dep: RuntimeDep): Promise<ResolvedVersion | null> {
  const response = await fetch(`${REGISTRY_BASE_URL}/${encodeURIComponent(dep.npmPackage)}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${dep.npmPackage} metadata`);
  }
  const metadata = (await response.json()) as AbbreviatedPackument;
  return pickHighestSatisfying(metadata, dep);
}

/**
 * A download failure that a later attempt may well succeed at — the network,
 * a timeout, or the registry having a bad moment — as opposed to a tarball
 * or bundle that is itself broken.
 */
class TransientDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientDownloadError';
  }
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Fetch the resolved tarball's raw bytes, distinguishing transient failures from a bad response. */
async function fetchTarball(resolved: ResolvedVersion): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(resolved.tarballUrl, { signal: AbortSignal.timeout(TARBALL_TIMEOUT_MS) });
  } catch (error) {
    throw new TransientDownloadError(`Downloading ${resolved.tarballUrl} failed: ${String(error)}`);
  }
  if (!response.ok) {
    const message = `HTTP ${response.status} downloading ${resolved.tarballUrl}`;
    throw isTransientStatus(response.status) ? new TransientDownloadError(message) : new Error(message);
  }
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new TransientDownloadError(`Reading ${resolved.tarballUrl} failed: ${String(error)}`);
  }
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
  const tarball = await fetchTarball(resolved);
  // Verify BEFORE extracting; nothing unverified is ever written to the cache.
  // The tarball-wide sha512 covers every extracted file in one check.
  verifySriIntegrity(tarball, resolved.integrity);
  // Extract everything up front so a missing entry aborts before any writes.
  const [entry, ...sidecars] = dep.files.map((file, index) => ({
    // npm tarballs prefix all entries with `package/`.
    bytes: extractTarEntry(tarball, `package/${file}`, MAX_BUNDLE_UNCOMPRESSED_BYTES),
    installedName: installedFileName(file, index === 0),
  }));

  mkdirSync(versionDir, { recursive: true, mode: 0o700 });
  for (const file of [...sidecars, entry]) {
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

/**
 * Remove a version dir whose bundle failed to install or import. Deleting it,
 * rather than leaving it for the offline fallback to trip over on every run,
 * is what lets the cache heal: older downloaded upgrades get their turn now,
 * and the next resolution after the TTL downloads the version fresh.
 */
function quarantineVersion(cacheDir: string, version: string): void {
  try {
    rmSync(join(cacheDir, version), { recursive: true, force: true });
  } catch {
    // Best-effort (e.g. a file still open elsewhere); the retryAt marker
    // keeps the resolved version skipped regardless.
  }
}

/**
 * Previously downloaded upgrades — complete installs inside the range and
 * newer than the compiled-in version — newest first. The offline fallback.
 */
function downloadedUpgrades(cacheDir: string, dep: RuntimeDep): string[] {
  let entries: string[];
  try {
    entries = readdirSync(cacheDir);
  } catch {
    return [];
  }
  return rsort(entries.filter((entry) => isUpgrade(entry, dep) && existsSync(entryPath(cacheDir, entry, dep))));
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
    let resolution = readResolutionCache(cacheDir, dep);
    if (!resolution) {
      try {
        resolution = { resolved: await fetchResolution(dep), installFailed: false };
        writeResolutionCache(cacheDir, dep, resolution.resolved);
      } catch (error) {
        logWarn(`Version resolution for runtime dep ${dep.npmPackage} failed:`, error);
      }
    }

    // A definitive answer from the registry: nothing newer than what this
    // binary already ships. Not a failure, so no fallback either — a cached
    // older upgrade (or one since deprecated) must not outrank the compiled-in
    // module.
    if (resolution !== null && resolution.resolved === null) return null;

    // A quarantined version is left alone until its retry time: not
    // re-downloaded, and not re-imported even if its directory is still there.
    let quarantined = resolution?.installFailed ? resolution.resolved?.version : undefined;
    if (resolution?.resolved && !resolution.installFailed) {
      const { resolved } = resolution;
      try {
        const bundlePath = entryPath(cacheDir, resolved.version, dep);
        if (!existsSync(bundlePath)) {
          await downloadBundle(dep, resolved, join(cacheDir, resolved.version));
          cleanupStaleVersions(cacheDir, resolved.version);
        }
        return await importBundle(bundlePath);
      } catch (error) {
        logWarn(`Runtime bundle install for ${dep.npmPackage}@${resolved.version} failed:`, error);
        // Quarantine: drop the version dir so neither this run's fallback nor
        // the next run imports a bundle that just failed, and remember the
        // failure so invocations don't keep re-downloading. A tarball that
        // can't install (e.g. the package hasn't published a bundle yet) or a
        // bundle that won't import stays quarantined until the resolution
        // expires; a network blip only briefly.
        quarantineVersion(cacheDir, resolved.version);
        quarantined = resolved.version;
        const backoff = error instanceof TransientDownloadError ? TRANSIENT_RETRY_MS : RESOLUTION_TTL_MS;
        writeResolutionCache(cacheDir, dep, resolved, Date.now() + backoff);
      }
    }

    // Resolution or install failed — a previously downloaded upgrade (verified
    // when it was installed) still works offline. Newest first; one that no
    // longer imports is quarantined so the next gets its turn.
    for (const version of downloadedUpgrades(cacheDir, dep)) {
      if (version === quarantined) continue;
      try {
        return await importBundle(entryPath(cacheDir, version, dep));
      } catch (error) {
        logWarn(`Cached runtime bundle ${dep.npmPackage}@${version} failed to import; removing it:`, error);
        quarantineVersion(cacheDir, version);
      }
    }
    return null;
  } catch (error) {
    logWarn(`Runtime bundle for ${dep.npmPackage} unavailable; using the compiled-in module:`, error);
    return null;
  }
}

const moduleCache = new Map<RuntimeDepName, Record<string, unknown> | null>();

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
