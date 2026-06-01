/**
 * Persistent device identifier for telemetry correlation.
 *
 * Stored at ~/.workos/device-id as a plain UTF-8 UUID string. Not a secret
 * — this is a convenience identifier that survives keyring unavailability.
 * Any IO failure falls through to a one-shot UUID for the current session.
 */

import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// RFC 4122 v4 format — matches what `crypto.randomUUID()` produces.
// Rejects non-UUID strings like "------------------------------------".
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cached: string | undefined;
let pending: Promise<string> | undefined;

function getDeviceIdPath(): string {
  return path.join(os.homedir(), '.workos', 'device-id');
}

/**
 * Asynchronously resolve (and lazily create) the device id without blocking
 * the event loop. Memoized: the first call performs the IO, concurrent and
 * later callers await the same promise. Populates the shared cache that the
 * synchronous getDeviceId() reads, so prewarming this at startup keeps the
 * synchronous telemetry path off blocking fs IO. Never rejects.
 */
export function loadDeviceId(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;

  pending = (async () => {
    const filePath = getDeviceIdPath();
    try {
      try {
        const raw = (await readFile(filePath, 'utf8')).trim();
        if (UUID_V4_REGEX.test(raw)) {
          cached = raw;
          return raw;
        }
      } catch {
        // Missing/unreadable file — fall through and create it.
      }

      const id = crypto.randomUUID();
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      await writeFile(filePath, id, { encoding: 'utf8', mode: 0o600 });
      cached = id;
      return id;
    } catch {
      // IO failure (readonly FS, permission denied, etc.) — fall through to
      // a session-scoped UUID, cached for the rest of this process.
      cached = crypto.randomUUID();
      return cached;
    } finally {
      pending = undefined;
    }
  })();

  return pending;
}

/**
 * Synchronous accessor for the telemetry event path. Returns the prewarmed
 * value when loadDeviceId() has run; otherwise falls back to a one-time
 * synchronous read of the same file (returning the persisted id, so the value
 * never diverges from the async path). On any IO failure, returns a one-shot
 * UUID scoped to the current process — never throws.
 */
export function getDeviceId(): string {
  if (cached) return cached;

  const filePath = getDeviceIdPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (UUID_V4_REGEX.test(raw)) {
        cached = raw;
        return raw;
      }
    }

    const id = crypto.randomUUID();
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, id, { encoding: 'utf8', mode: 0o600 });
    cached = id;
    return id;
  } catch {
    // IO failure (readonly FS, permission denied, etc.) — fall through to
    // a session-scoped UUID. Cache it so subsequent calls in this process
    // return the same value; the next process run will retry IO.
    cached = crypto.randomUUID();
    return cached;
  }
}

/** Test seam — resets the in-memory cache between test cases. */
export function __resetDeviceIdCache(): void {
  cached = undefined;
  pending = undefined;
}
