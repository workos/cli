import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

const { acquireLock } = await import('./file-lock.js');

describe('file-lock', () => {
  let testDir: string;
  let lockPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'file-lock-test-'));
    lockPath = join(testDir, 'test.lock');
  });

  afterEach(() => {
    if (existsSync(lockPath)) unlinkSync(lockPath);
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  describe('acquireLock', () => {
    it('creates lock file and releases it', async () => {
      const lock = await acquireLock({ lockPath });

      expect(existsSync(lockPath)).toBe(true);

      // Verify lock file contains pid and timestamp
      const content = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(content.pid).toBe(process.pid);
      expect(content.timestamp).toBeGreaterThan(0);

      lock.release();
      expect(existsSync(lockPath)).toBe(false);
    });

    it('creates parent directory if missing', async () => {
      const nestedLock = join(testDir, 'nested', 'dir', 'test.lock');

      const lock = await acquireLock({ lockPath: nestedLock });
      expect(existsSync(nestedLock)).toBe(true);

      lock.release();
    });

    it('second acquire waits until first releases', async () => {
      const lock1 = await acquireLock({ lockPath, timeoutMs: 2000 });

      // Start second acquire in background
      let lock2Acquired = false;
      const lock2Promise = acquireLock({ lockPath, timeoutMs: 2000, retryIntervalMs: 50 }).then((lock) => {
        lock2Acquired = true;
        return lock;
      });

      // Give it a tick to try acquiring
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(lock2Acquired).toBe(false);

      // Release first lock
      lock1.release();

      // Second should now acquire
      const lock2 = await lock2Promise;
      expect(lock2Acquired).toBe(true);

      lock2.release();
    });

    it('times out when lock is held', async () => {
      const lock1 = await acquireLock({ lockPath });

      await expect(acquireLock({ lockPath, timeoutMs: 200, retryIntervalMs: 50 })).rejects.toThrow(
        /Lock acquisition timed out/,
      );

      lock1.release();
    });

    it('reclaims stale lock', async () => {
      // Create a stale lock file manually
      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        lockPath,
        JSON.stringify({
          pid: 99999,
          timestamp: Date.now() - 60_000, // 60s ago
        }),
      );

      // Should reclaim and acquire
      const lock = await acquireLock({ lockPath, staleMs: 30_000 });
      expect(existsSync(lockPath)).toBe(true);

      // Verify it's our lock now
      const content = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(content.pid).toBe(process.pid);

      lock.release();
    });

    it('does not reclaim non-stale lock', async () => {
      // Create a fresh lock file
      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        lockPath,
        JSON.stringify({
          pid: 99999,
          timestamp: Date.now(), // just now
        }),
      );

      await expect(acquireLock({ lockPath, timeoutMs: 200, staleMs: 30_000, retryIntervalMs: 50 })).rejects.toThrow(
        /Lock acquisition timed out/,
      );
    });

    it('release is idempotent', async () => {
      const lock = await acquireLock({ lockPath });

      lock.release();
      expect(() => lock.release()).not.toThrow();
    });
  });
});
