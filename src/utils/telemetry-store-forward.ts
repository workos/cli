import { readFileSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { telemetryClient } from './telemetry-client.js';
import { debug } from './debug.js';

const PENDING_DIR = join(tmpdir(), 'workos-cli-telemetry');
const PENDING_FILE = join(PENDING_DIR, `pending-${process.pid}.json`);
const MAX_PENDING_FILES = 100;
const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function safeUnlink(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

/**
 * Register a sync exit handler that persists unsent events to disk.
 * Called once at startup. Uses PID in filename to prevent concurrent
 * CLI invocations from colliding.
 */
export function installStoreForward(): void {
  process.on('exit', () => {
    telemetryClient.persistToFile(PENDING_FILE);
  });
}

/**
 * On startup, check for ANY pending files from previous invocations
 * (could be from different PIDs) and send them. Non-blocking, fire-and-forget.
 */
export async function recoverPendingEvents(): Promise<void> {
  try {
    if (!existsSync(PENDING_DIR)) return;
    const files = readdirSync(PENDING_DIR).filter((f) => f.startsWith('pending-') && f.endsWith('.json'));
    const now = Date.now();
    const pendingFiles: Array<{ file: string; filePath: string; mtimeMs: number }> = [];

    for (const file of files) {
      const filePath = join(PENDING_DIR, file);
      try {
        const { mtimeMs } = statSync(filePath);
        if (now - mtimeMs > MAX_PENDING_AGE_MS) {
          debug(`[Telemetry] Dropping stale pending file: ${file}`);
          safeUnlink(filePath);
        } else {
          pendingFiles.push({ file, filePath, mtimeMs });
        }
      } catch {
        debug(`[Telemetry] Dropping unreadable pending file: ${file}`);
        safeUnlink(filePath);
      }
    }

    pendingFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const filesToRecover = pendingFiles.slice(0, MAX_PENDING_FILES);
    for (const dropped of pendingFiles.slice(MAX_PENDING_FILES)) {
      debug(`[Telemetry] Dropping excess pending file: ${dropped.file}`);
      safeUnlink(dropped.filePath);
    }

    const recoveredFiles: string[] = [];
    for (const { filePath } of filesToRecover) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const events = JSON.parse(raw);
        if (Array.isArray(events) && events.length > 0) {
          telemetryClient.queueEvents(events);
          recoveredFiles.push(filePath);
        } else {
          // Empty file — delete immediately
          safeUnlink(filePath);
        }
      } catch {
        // Corrupted file — delete and move on
        safeUnlink(filePath);
      }
    }

    // Delete source files — events are now in memory regardless of flush outcome.
    // If flush succeeds: events sent, done.
    // If flush fails: events stay in memory, exit handler re-persists to new PID file.
    for (const filePath of recoveredFiles) {
      safeUnlink(filePath);
    }

    // Flush all recovered events in one batch
    await telemetryClient.flush();
  } catch {
    debug('[Telemetry] Store-forward recovery failed silently');
  }
}
