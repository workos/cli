import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync, mkdirSync, statSync } from 'node:fs';
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

const {
  getPreferences,
  loadPreferences,
  isTelemetryOptedOut,
  setTelemetryOptedOut,
  isNoticeShown,
  markNoticeShown,
  envTelemetryOverride,
  isTelemetryEnabled,
  getTelemetrySource,
  getPreferencesPath,
  clearPreferences,
  __resetPreferencesCache,
} = await import('./preferences.js');

const originalTelemetryEnv = process.env.WORKOS_TELEMETRY;

function writePrefs(value: unknown): void {
  const workosDir = join(testDir, '.workos');
  mkdirSync(workosDir, { recursive: true });
  writeFileSync(join(workosDir, 'preferences.json'), JSON.stringify(value), 'utf8');
}

function writeRawPrefs(raw: string): void {
  const workosDir = join(testDir, '.workos');
  mkdirSync(workosDir, { recursive: true });
  writeFileSync(join(workosDir, 'preferences.json'), raw, 'utf8');
}

describe('preferences', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'preferences-test-'));
    __resetPreferencesCache();
    delete process.env.WORKOS_TELEMETRY;
  });

  afterEach(() => {
    try {
      chmodSync(join(testDir, '.workos'), 0o700);
    } catch {
      // ignore — dir may not exist or already writable
    }
    try {
      chmodSync(testDir, 0o700);
    } catch {
      // ignore
    }
    rmSync(testDir, { recursive: true, force: true });
    if (originalTelemetryEnv !== undefined) {
      process.env.WORKOS_TELEMETRY = originalTelemetryEnv;
    } else {
      delete process.env.WORKOS_TELEMETRY;
    }
  });

  describe('getPreferences', () => {
    it('returns {} when no file exists', () => {
      expect(getPreferences()).toEqual({});
    });

    it('reads a saved preferences object', () => {
      writePrefs({ telemetry: { optedOut: true } });
      expect(getPreferences()).toEqual({ telemetry: { optedOut: true } });
    });

    it('returns {} on corrupt JSON (does not throw, does not delete)', () => {
      writeRawPrefs('{ this is not json');
      expect(getPreferences()).toEqual({});
      // File is left intact for a later clean overwrite.
      expect(existsSync(getPreferencesPath())).toBe(true);
    });

    it('returns {} when the file parses to a non-object', () => {
      writeRawPrefs('"true"');
      expect(getPreferences()).toEqual({});
    });

    it('caches after the first read', () => {
      writePrefs({ telemetry: { optedOut: true } });
      expect(getPreferences()).toEqual({ telemetry: { optedOut: true } });
      // Mutate the file on disk; the cached value should NOT change in-process.
      writePrefs({ telemetry: { optedOut: false } });
      expect(getPreferences()).toEqual({ telemetry: { optedOut: true } });
    });
  });

  describe('loadPreferences (async prewarm)', () => {
    it('resolves to {} when no file exists', async () => {
      await expect(loadPreferences()).resolves.toEqual({});
    });

    it('warms the cache the synchronous getPreferences() reads', async () => {
      writePrefs({ telemetry: { optedOut: true } });
      const loaded = await loadPreferences();
      expect(loaded).toEqual({ telemetry: { optedOut: true } });
      expect(getPreferences()).toEqual({ telemetry: { optedOut: true } });
    });

    it('memoizes concurrent callers to a single value', async () => {
      writePrefs({ telemetry: { optedOut: true } });
      const [a, b] = await Promise.all([loadPreferences(), loadPreferences()]);
      expect(a).toBe(b);
    });

    it('never rejects on corrupt JSON', async () => {
      writeRawPrefs('not json');
      await expect(loadPreferences()).resolves.toEqual({});
    });
  });

  describe('savePreferences / setTelemetryOptedOut', () => {
    it('round-trips opt-out true then opt-in false', () => {
      setTelemetryOptedOut(true);
      expect(isTelemetryOptedOut()).toBe(true);
      expect(isTelemetryEnabled()).toBe(false);

      setTelemetryOptedOut(false);
      expect(isTelemetryOptedOut()).toBe(false);
      expect(isTelemetryEnabled()).toBe(true);
    });

    it('writes the file with mode 0o600', () => {
      setTelemetryOptedOut(true);
      const mode = statSync(getPreferencesPath()).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('overwrites a corrupt file cleanly', () => {
      writeRawPrefs('garbage');
      setTelemetryOptedOut(true);
      expect(JSON.parse(readFileSync(getPreferencesPath(), 'utf8'))).toEqual({ telemetry: { optedOut: true } });
    });

    it('preserves unrelated existing fields (read-modify-write)', () => {
      // Simulate a Phase 2 field already on disk.
      writePrefs({ telemetry: { noticeShownAt: '2026-01-01T00:00:00.000Z' } });
      __resetPreferencesCache();
      setTelemetryOptedOut(true);
      const onDisk = JSON.parse(readFileSync(getPreferencesPath(), 'utf8'));
      expect(onDisk.telemetry.optedOut).toBe(true);
      expect(onDisk.telemetry.noticeShownAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('throws when the filesystem is read-only', () => {
      chmodSync(testDir, 0o500);
      expect(() => setTelemetryOptedOut(true)).toThrow();
    });

    it('updates the in-memory cache after a write', () => {
      setTelemetryOptedOut(true);
      // No reset — the cache should reflect the write without re-reading disk.
      expect(getPreferences().telemetry?.optedOut).toBe(true);
    });
  });

  describe('isNoticeShown / markNoticeShown', () => {
    it('isNoticeShown is false when nothing is persisted', () => {
      expect(isNoticeShown()).toBe(false);
    });

    it('markNoticeShown persists a timestamp that isNoticeShown reads back', () => {
      markNoticeShown();
      expect(isNoticeShown()).toBe(true);

      const onDisk = JSON.parse(readFileSync(getPreferencesPath(), 'utf8'));
      expect(typeof onDisk.telemetry.noticeShownAt).toBe('string');
      // Round-trips as a valid ISO timestamp.
      expect(Number.isNaN(Date.parse(onDisk.telemetry.noticeShownAt))).toBe(false);
    });

    it('isNoticeShown is true for an existing noticeShownAt on disk', () => {
      writePrefs({ telemetry: { noticeShownAt: '2026-01-01T00:00:00.000Z' } });
      expect(isNoticeShown()).toBe(true);
    });

    it('markNoticeShown preserves an existing optedOut flag (no clobber)', () => {
      setTelemetryOptedOut(true);
      markNoticeShown();

      const onDisk = JSON.parse(readFileSync(getPreferencesPath(), 'utf8'));
      expect(onDisk.telemetry.optedOut).toBe(true);
      expect(typeof onDisk.telemetry.noticeShownAt).toBe('string');
    });

    it('setTelemetryOptedOut preserves an existing noticeShownAt (no clobber)', () => {
      markNoticeShown();
      setTelemetryOptedOut(true);

      const onDisk = JSON.parse(readFileSync(getPreferencesPath(), 'utf8'));
      expect(onDisk.telemetry.optedOut).toBe(true);
      expect(typeof onDisk.telemetry.noticeShownAt).toBe('string');
    });
  });

  describe('envTelemetryOverride (tri-state)', () => {
    it('returns true for "true"', () => {
      process.env.WORKOS_TELEMETRY = 'true';
      expect(envTelemetryOverride()).toBe(true);
    });

    it('returns false for "false"', () => {
      process.env.WORKOS_TELEMETRY = 'false';
      expect(envTelemetryOverride()).toBe(false);
    });

    it('returns undefined when unset', () => {
      delete process.env.WORKOS_TELEMETRY;
      expect(envTelemetryOverride()).toBeUndefined();
    });

    it('returns undefined for garbage like "1" (falls through to preference)', () => {
      process.env.WORKOS_TELEMETRY = '1';
      expect(envTelemetryOverride()).toBeUndefined();
    });
  });

  describe('isTelemetryEnabled — env overrides preference in both directions', () => {
    // prefs ∈ {opted-out, not} × env ∈ {unset, 'true', 'false', '1'}
    const cases: Array<{ optedOut: boolean; env: string | undefined; expected: boolean }> = [
      { optedOut: false, env: undefined, expected: true },
      { optedOut: false, env: 'true', expected: true },
      { optedOut: false, env: 'false', expected: false }, // env disables even when opted in
      { optedOut: false, env: '1', expected: true },
      { optedOut: true, env: undefined, expected: false },
      { optedOut: true, env: 'true', expected: true }, // env enables even when opted out
      { optedOut: true, env: 'false', expected: false },
      { optedOut: true, env: '1', expected: false }, // garbage falls through to opt-out
    ];

    for (const { optedOut, env, expected } of cases) {
      it(`optedOut=${optedOut}, WORKOS_TELEMETRY=${env ?? 'unset'} => ${expected}`, () => {
        if (optedOut) setTelemetryOptedOut(true);
        if (env === undefined) delete process.env.WORKOS_TELEMETRY;
        else process.env.WORKOS_TELEMETRY = env;
        expect(isTelemetryEnabled()).toBe(expected);
      });
    }
  });

  describe('getTelemetrySource', () => {
    it('is "env" when WORKOS_TELEMETRY is explicitly set', () => {
      process.env.WORKOS_TELEMETRY = 'true';
      setTelemetryOptedOut(true);
      expect(getTelemetrySource()).toBe('env');
    });

    it('is "preference" when only the opt-out flag is set', () => {
      delete process.env.WORKOS_TELEMETRY;
      setTelemetryOptedOut(true);
      expect(getTelemetrySource()).toBe('preference');
    });

    it('is "default" when the flag is explicitly false (opted back in)', () => {
      delete process.env.WORKOS_TELEMETRY;
      setTelemetryOptedOut(false);
      // opted-in matches the fresh-install outcome, so the source is 'default',
      // not 'preference' — consistent with isTelemetryEnabled()'s precedence.
      expect(getTelemetrySource()).toBe('default');
    });

    it('is "default" when nothing is set', () => {
      delete process.env.WORKOS_TELEMETRY;
      expect(getTelemetrySource()).toBe('default');
    });
  });

  describe('clearPreferences', () => {
    it('deletes the file and returns telemetry to its default state', () => {
      setTelemetryOptedOut(true);
      markNoticeShown();
      expect(existsSync(getPreferencesPath())).toBe(true);

      clearPreferences();

      expect(existsSync(getPreferencesPath())).toBe(false);
      // In-process cache reflects the cleared state immediately.
      expect(isTelemetryOptedOut()).toBe(false);
      expect(isNoticeShown()).toBe(false);
    });

    it('is a no-op when the file does not exist', () => {
      expect(existsSync(getPreferencesPath())).toBe(false);
      expect(() => clearPreferences()).not.toThrow();
    });

    it('reads as empty preferences after a fresh process (cache reset)', () => {
      setTelemetryOptedOut(true);
      clearPreferences();
      __resetPreferencesCache(); // simulate a new process
      expect(getPreferences()).toEqual({});
    });
  });
});
