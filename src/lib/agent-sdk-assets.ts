import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  AGENT_SDK_EXECUTABLE_NAME,
  AGENT_SDK_EXECUTABLE_SHA256,
  AGENT_SDK_EXECUTABLE_SIZE,
  AGENT_SDK_PACKAGE,
  AGENT_SDK_TARBALL_URL,
  AGENT_SDK_TARGET,
  AGENT_SDK_VERSION,
} from '../generated/agent-sdk-manifest.js';

export { AGENT_SDK_TARGET, AGENT_SDK_VERSION } from '../generated/agent-sdk-manifest.js';

export type DownloadProgress = {
  receivedBytes: number;
  totalBytes: number | null;
};

let cachedExecutablePath: string | undefined;

/** Detect a musl libc runtime (Alpine etc.) the same way napi-rs loaders do. */
function isMuslRuntime(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    if (readFileSync('/usr/bin/ldd', 'utf8').includes('musl')) return true;
  } catch {
    // No readable /usr/bin/ldd — fall through to the process report.
  }
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
    if (report?.header) return !report.header.glibcVersionRuntime;
  } catch {
    // Report unavailable — assume glibc.
  }
  return false;
}

function runtimeTarget(): string {
  return `${process.platform}-${process.arch}${isMuslRuntime() ? '-musl' : ''}`;
}

/**
 * Whether a module URL points into a Bun compiled binary's virtual filesystem:
 * `/$bunfs/` on POSIX, `B:\~BUN\` on Windows — which import.meta.url surfaces
 * with the tilde percent-encoded (`file:///B:/%7EBUN/root/…`). Exported for
 * tests.
 */
export function isBunVirtualFsUrl(url: string): boolean {
  return url.includes('$bunfs') || url.includes('~BUN') || url.includes('%7EBUN');
}

/** Running from a compiled binary: the module graph lives in Bun's virtual filesystem. */
function isCompiledBinary(): boolean {
  return isBunVirtualFsUrl(import.meta.url);
}

function agentSdkCacheRoot(): string {
  return join(homedir(), '.workos', 'cache', 'agent-sdk');
}

function cacheKey(): string {
  return `${AGENT_SDK_VERSION}-${AGENT_SDK_TARGET}`;
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Resolve the executable from node_modules when running from source (dev, tests, evals). */
function resolveFromNodeModules(): string {
  const packageJsonPath = fileURLToPath(import.meta.resolve(`${AGENT_SDK_PACKAGE}/package.json`));
  const path = join(dirname(packageJsonPath), AGENT_SDK_EXECUTABLE_NAME);
  if (!existsSync(path)) {
    throw new Error(`Agent SDK executable not found at ${path}; run \`bun install\``);
  }
  return path;
}

// The uncompressed tarball is the pinned executable plus a handful of small
// metadata files. Cap gunzip output generously above that so a compromised or
// corrupted response can't expand a gzip bomb in memory before the sha256 gate
// (which runs only after decompression) gets a chance to reject it.
const MAX_TARBALL_UNCOMPRESSED_BYTES = AGENT_SDK_EXECUTABLE_SIZE + 64 * 1024 * 1024;

/**
 * Extract a single entry from a gzipped npm tarball. Exported for tests.
 *
 * Minimal ustar reader: npm tarballs are flat `package/…` archives well within
 * ustar limits, so pax/GNU long-name extensions never apply to the entry we
 * want — unknown entry types are skipped by the generic size-based walk.
 */
export function extractTarEntry(tarGz: Buffer, entryName: string): Buffer {
  const raw = gunzipSync(tarGz, { maxOutputLength: MAX_TARBALL_UNCOMPRESSED_BYTES });
  let offset = 0;
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim(), 8);
    if (Number.isNaN(size) || size < 0) {
      throw new Error(`Malformed tar header at offset ${offset}`);
    }
    const dataStart = offset + 512;
    if (fullName === entryName) {
      if (dataStart + size > raw.length) {
        throw new Error(`Truncated tar entry ${entryName}`);
      }
      return Buffer.from(raw.subarray(dataStart, dataStart + size));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Entry ${entryName} not found in tarball`);
}

/** Abort a download that goes this long without a data chunk, so a stalled connection can't hang forever. */
const DOWNLOAD_STALL_TIMEOUT_MS = 30_000;

async function downloadTarballOnce(
  url: string,
  onProgress: ((progress: DownloadProgress) => void) | undefined,
  stallTimeoutMs: number,
): Promise<Buffer> {
  const controller = new AbortController();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const armStallTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallTimeoutMs);
  };

  armStallTimer();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: HTTP ${response.status} from ${url}`);
    }
    const contentLength = Number(response.headers.get('content-length'));
    const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;

    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    const reader = response.body.getReader();
    onProgress?.({ receivedBytes, totalBytes });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armStallTimer();
      chunks.push(value);
      receivedBytes += value.byteLength;
      onProgress?.({ receivedBytes, totalBytes });
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (stalled) {
      throw new Error(`Download stalled: no data from ${url} for ${stallTimeoutMs / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download the pinned tarball, retrying once on any network, stall, or HTTP
 * failure. Checksum verification stays in the caller and is never retried.
 * `onRetry` fires before the second attempt (the retry restarts the byte
 * count, so callers driving a progress bar use it to reset their throttle).
 * Exported for tests.
 */
export async function downloadTarball(
  onProgress?: (progress: DownloadProgress) => void,
  stallTimeoutMs: number = DOWNLOAD_STALL_TIMEOUT_MS,
  onRetry?: () => void,
): Promise<Buffer> {
  const url = AGENT_SDK_TARBALL_URL;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await downloadTarballOnce(url, onProgress, stallTimeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt === 0) onRetry?.();
    }
  }
  throw lastError;
}

// Only reap cache dirs untouched for this long. A newer sibling may belong to
// a concurrently running other-version CLI (mid-download, or spawned from that
// dir mid-agent-run), so leaving fresh dirs alone avoids yanking an executable
// out from under it — mirrors the skills reaper's staleness guard.
const STALE_CACHE_MS = 24 * 60 * 60 * 1000;

/**
 * Best-effort reap of cache dirs for other CLI/SDK versions — each version
 * keys its own `<version>-<target>` dir (~230MB), which would otherwise
 * accumulate forever. Runs only after a successful download of the current
 * version, and skips any sibling touched within STALE_CACHE_MS so a concurrent
 * run's dir is never removed.
 */
function cleanupStaleCacheDirs(): void {
  const root = agentSdkCacheRoot();
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_CACHE_MS;
  for (const entry of entries) {
    if (entry === cacheKey()) continue;
    const path = join(root, entry);
    try {
      // Fresh dir — may be in use by a concurrent run; leave it for a later reap.
      if (statSync(path).mtimeMs >= cutoff) continue;
      rmSync(path, { recursive: true, force: true });
    } catch {
      // In use, already gone, or unreadable — skip it.
    }
  }
}

/**
 * Return a spawnable path to the pinned Claude Agent SDK executable.
 *
 * Running from source: resolves it from node_modules. Running from the
 * compiled binary: returns the cached download under ~/.workos/cache, or
 * performs a one-time download of the exact pinned version from the npm
 * registry, verifies its sha256 against the build-time manifest, and installs
 * it atomically (write-to-temp + rename; a concurrent winner is accepted only
 * if its bytes verify).
 */
export async function ensureClaudeCodeExecutable(
  onProgress?: (progress: DownloadProgress) => void,
  onRetry?: () => void,
): Promise<string> {
  if (cachedExecutablePath) return cachedExecutablePath;

  const target = runtimeTarget();
  if (target !== AGENT_SDK_TARGET) {
    throw new Error(`Agent SDK target mismatch: binary was built for ${AGENT_SDK_TARGET}, running on ${target}`);
  }

  if (!isCompiledBinary()) {
    cachedExecutablePath = resolveFromNodeModules();
    return cachedExecutablePath;
  }

  const finalPath = join(agentSdkCacheRoot(), cacheKey(), AGENT_SDK_EXECUTABLE_NAME);
  if (existsSync(finalPath) && statSync(finalPath).size === AGENT_SDK_EXECUTABLE_SIZE) {
    cachedExecutablePath = finalPath;
    return finalPath;
  }

  const tarball = await downloadTarball(onProgress, undefined, onRetry);
  const executable = extractTarEntry(tarball, `package/${AGENT_SDK_EXECUTABLE_NAME}`);
  const digest = sha256Hex(executable);
  if (digest !== AGENT_SDK_EXECUTABLE_SHA256) {
    throw new Error(
      `Agent SDK checksum mismatch for ${AGENT_SDK_PACKAGE}@${AGENT_SDK_VERSION}: ` +
        `expected ${AGENT_SDK_EXECUTABLE_SHA256}, got ${digest}. Refusing to install it.`,
    );
  }

  mkdirSync(dirname(finalPath), { recursive: true, mode: 0o700 });
  const temporary = `${finalPath}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(temporary, executable, { mode: 0o755 });
    chmodSync(temporary, 0o755);
    renameSync(temporary, finalPath);
  } catch (error) {
    // A concurrent process may have won the install race (or holds the file
    // open on Windows). Accept its copy only if the bytes verify.
    try {
      if (existsSync(finalPath) && sha256Hex(readFileSync(finalPath)) === AGENT_SDK_EXECUTABLE_SHA256) {
        rmSync(temporary, { force: true });
        cachedExecutablePath = finalPath;
        return finalPath;
      }
    } catch {
      // Fall through to the original failure.
    }
    rmSync(temporary, { force: true });
    throw error;
  }

  cleanupStaleCacheDirs();
  cachedExecutablePath = finalPath;
  return finalPath;
}
