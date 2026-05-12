/**
 * Persistent device identifier for telemetry correlation.
 *
 * Stored at ~/.workos/device-id as a plain UTF-8 UUID string. Not a secret
 * — this is a convenience identifier that survives keyring unavailability.
 * Any IO failure falls through to a one-shot UUID for the current session.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// RFC 4122 v4 format — matches what `crypto.randomUUID()` produces.
// Rejects non-UUID strings like "------------------------------------".
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cached: string | undefined;

function getDeviceIdPath(): string {
  return path.join(os.homedir(), '.workos', 'device-id');
}

/**
 * Returns a stable UUID for this device. Lazily creates the file on first
 * call. On any IO failure, returns a one-shot UUID scoped to the current
 * process — never throws.
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
}
