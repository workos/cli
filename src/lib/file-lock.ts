/**
 * File-based advisory lock for cross-process coordination.
 * Uses atomic file creation (O_EXCL) to prevent races.
 */

import fs from 'node:fs';
import path from 'node:path';
import { logInfo, logWarn } from '../utils/debug.js';

export interface LockOptions {
  /** Lock file path */
  lockPath: string;
  /** Max time to hold lock before it's considered stale (default: 30000ms) */
  staleMs?: number;
  /** How long to wait for lock acquisition (default: 10000ms) */
  timeoutMs?: number;
  /** Polling interval while waiting (default: 100ms) */
  retryIntervalMs?: number;
}

export interface LockHandle {
  /** Release the lock */
  release: () => void;
}

interface LockFileContent {
  pid: number;
  timestamp: number;
}

function writeLockFile(lockPath: string): void {
  const dir = path.dirname(lockPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const content: LockFileContent = {
    pid: process.pid,
    timestamp: Date.now(),
  };

  const fd = fs.openSync(lockPath, 'wx');
  try {
    fs.writeSync(fd, JSON.stringify(content));
  } finally {
    fs.closeSync(fd);
  }
}

function readLockFile(lockPath: string): LockFileContent | null {
  try {
    const content = fs.readFileSync(lockPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function isLockStale(lock: LockFileContent, staleMs: number): boolean {
  return Date.now() - lock.timestamp > staleMs;
}

function reclaimStaleLock(lockPath: string): boolean {
  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire an advisory file lock.
 * Creates lock file atomically with O_EXCL.
 * Detects and reclaims stale locks older than staleMs.
 * Throws if lock cannot be acquired within timeoutMs.
 */
export async function acquireLock(options: LockOptions): Promise<LockHandle> {
  const { lockPath, staleMs = 30_000, timeoutMs = 10_000, retryIntervalMs = 100 } = options;

  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      writeLockFile(lockPath);
      logInfo(`[file-lock] Acquired: ${lockPath}`);

      return {
        release: () => {
          try {
            fs.unlinkSync(lockPath);
            logInfo(`[file-lock] Released: ${lockPath}`);
          } catch {
            // Lock file may already be gone (stale reclaim by another process)
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }

      // Lock file exists — check if stale
      const existing = readLockFile(lockPath);
      if (existing && isLockStale(existing, staleMs)) {
        logWarn(`[file-lock] Reclaiming stale lock (pid=${existing.pid}, age=${Date.now() - existing.timestamp}ms)`);
        if (reclaimStaleLock(lockPath)) {
          continue; // Retry immediately after reclaim
        }
      }

      // Check timeout
      if (Date.now() >= deadline) {
        throw new Error(`Lock acquisition timed out after ${timeoutMs}ms: ${lockPath}`);
      }

      // Wait and retry
      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
  }
}
