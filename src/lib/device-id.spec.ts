import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mutable testDir rebound in beforeEach; mock closes over it.
let testDir: string;

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    default: {
      ...original,
      homedir: () => testDir,
    },
    homedir: () => testDir,
  };
});

const { getDeviceId, loadDeviceId, __resetDeviceIdCache } = await import('./device-id.js');

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('device-id', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'device-id-test-'));
    __resetDeviceIdCache();
  });

  afterEach(() => {
    try {
      chmodSync(join(testDir, '.workos'), 0o700);
    } catch {
      // ignore — dir may not exist or already writable
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  it('creates the file on first call and returns a UUID', () => {
    const id = getDeviceId();

    expect(id).toMatch(UUID_V4_REGEX);
    const filePath = join(testDir, '.workos', 'device-id');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toBe(id);
  });

  it('returns the same cached UUID on subsequent calls', () => {
    const first = getDeviceId();
    const second = getDeviceId();
    expect(first).toBe(second);
  });

  it('reads existing UUID from disk (persists across process restarts)', () => {
    // First process writes the ID.
    const first = getDeviceId();

    // Simulate process restart by clearing in-memory cache.
    __resetDeviceIdCache();

    const second = getDeviceId();
    expect(second).toBe(first);
  });

  it('regenerates when the file contains a non-UUID', () => {
    const workosDir = join(testDir, '.workos');
    mkdirSync(workosDir, { recursive: true });
    writeFileSync(join(workosDir, 'device-id'), 'not-a-uuid', 'utf8');

    const id = getDeviceId();
    expect(id).toMatch(UUID_V4_REGEX);
    expect(id).not.toBe('not-a-uuid');
    // File should be rewritten with the new UUID.
    expect(readFileSync(join(workosDir, 'device-id'), 'utf8')).toBe(id);
  });

  it('regenerates when the file contains a 36-char non-v4 string', () => {
    // Guard against overly permissive regex validation — 36 hyphens passes
    // a naive `[0-9a-f-]{36}` check but is not a UUIDv4.
    const workosDir = join(testDir, '.workos');
    mkdirSync(workosDir, { recursive: true });
    const bogus = '------------------------------------';
    writeFileSync(join(workosDir, 'device-id'), bogus, 'utf8');

    const id = getDeviceId();
    expect(id).toMatch(UUID_V4_REGEX);
    expect(id).not.toBe(bogus);
  });

  it('falls back to a one-shot UUID when the filesystem is readonly', () => {
    // Make the home directory non-writable so mkdirSync throws.
    chmodSync(testDir, 0o500);

    const id = getDeviceId();
    expect(id).toMatch(UUID_V4_REGEX);
    // File was never created.
    expect(existsSync(join(testDir, '.workos', 'device-id'))).toBe(false);
  });

  it('persists fallback UUID across calls within the same process', () => {
    chmodSync(testDir, 0o500);
    const first = getDeviceId();
    const second = getDeviceId();
    expect(first).toBe(second);
  });

  describe('loadDeviceId (async startup path)', () => {
    it('creates the file on first call and returns a UUID', async () => {
      const id = await loadDeviceId();
      expect(id).toMatch(UUID_V4_REGEX);
      expect(readFileSync(join(testDir, '.workos', 'device-id'), 'utf8')).toBe(id);
    });

    it('reads an existing UUID from disk', async () => {
      const workosDir = join(testDir, '.workos');
      mkdirSync(workosDir, { recursive: true });
      const existing = '11111111-1111-4111-8111-111111111111';
      writeFileSync(join(workosDir, 'device-id'), existing, 'utf8');

      expect(await loadDeviceId()).toBe(existing);
    });

    it('memoizes: concurrent callers resolve to the same id (single write)', async () => {
      const [a, b] = await Promise.all([loadDeviceId(), loadDeviceId()]);
      expect(a).toBe(b);
    });

    it('warms the cache that the synchronous getDeviceId() reads', async () => {
      const loaded = await loadDeviceId();
      // No further IO: getDeviceId returns the prewarmed value.
      expect(getDeviceId()).toBe(loaded);
    });
  });
});
