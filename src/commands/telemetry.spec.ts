import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSetTelemetryOptedOut = vi.fn();
const mockIsTelemetryOptedOut = vi.fn();
const mockIsTelemetryEnabled = vi.fn();
const mockGetTelemetrySource = vi.fn();
const mockEnvTelemetryOverride = vi.fn();

vi.mock('../lib/preferences.js', () => ({
  setTelemetryOptedOut: (v: boolean) => mockSetTelemetryOptedOut(v),
  isTelemetryOptedOut: () => mockIsTelemetryOptedOut(),
  isTelemetryEnabled: () => mockIsTelemetryEnabled(),
  getTelemetrySource: () => mockGetTelemetrySource(),
  envTelemetryOverride: () => mockEnvTelemetryOverride(),
}));

// Keep human-mode confirmation lines stable regardless of host env.
vi.mock('../utils/command-invocation.js', () => ({
  formatWorkOSCommand: (args: string) => `workos ${args}`,
}));

const { setOutputMode } = await import('../utils/output.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { runTelemetryOptOut, runTelemetryOptIn, runTelemetryStatus } = await import('./telemetry.js');

describe('telemetry commands', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // clearAllMocks wipes call history but not implementations set with
    // mockImplementation, so reset the write mock to a no-op each test.
    mockSetTelemetryOptedOut.mockReset();
    // Sensible defaults; individual tests override.
    mockIsTelemetryOptedOut.mockReturnValue(false);
    mockIsTelemetryEnabled.mockReturnValue(true);
    mockGetTelemetrySource.mockReturnValue('default');
    mockEnvTelemetryOverride.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setOutputMode('human');
  });

  describe('runTelemetryOptOut', () => {
    it('persists optedOut=true and confirms', async () => {
      mockIsTelemetryOptedOut.mockReturnValue(false);
      await runTelemetryOptOut();
      expect(mockSetTelemetryOptedOut).toHaveBeenCalledWith(true);
      expect(consoleOutput.some((l) => l.includes('disabled'))).toBe(true);
    });

    it('is idempotent and honest when already opted out', async () => {
      mockIsTelemetryOptedOut.mockReturnValue(true);
      await runTelemetryOptOut();
      expect(mockSetTelemetryOptedOut).toHaveBeenCalledWith(true);
      expect(consoleOutput.some((l) => l.includes('already opted out'))).toBe(true);
    });

    it('surfaces a CliExit error when the write fails', async () => {
      mockIsTelemetryOptedOut.mockReturnValue(false);
      mockSetTelemetryOptedOut.mockImplementation(() => {
        throw new Error('EROFS');
      });
      await expect(runTelemetryOptOut()).rejects.toBeInstanceOf(CliExit);
    });

    it('outputs JSON in json mode', async () => {
      setOutputMode('json');
      mockIsTelemetryOptedOut.mockReturnValue(false);
      await runTelemetryOptOut();
      const out = JSON.parse(consoleOutput[0]);
      expect(out).toEqual({ status: 'ok', optedOut: true, alreadyOptedOut: false });
    });
  });

  describe('runTelemetryOptIn', () => {
    it('persists optedOut=false and confirms re-enable', async () => {
      mockIsTelemetryOptedOut.mockReturnValue(true);
      await runTelemetryOptIn();
      expect(mockSetTelemetryOptedOut).toHaveBeenCalledWith(false);
      expect(consoleOutput.some((l) => l.includes('re-enabled'))).toBe(true);
    });

    it('is honest when already opted in', async () => {
      mockIsTelemetryOptedOut.mockReturnValue(false);
      await runTelemetryOptIn();
      expect(mockSetTelemetryOptedOut).toHaveBeenCalledWith(false);
      expect(consoleOutput.some((l) => l.includes('already enabled'))).toBe(true);
    });

    it('outputs JSON in json mode', async () => {
      setOutputMode('json');
      mockIsTelemetryOptedOut.mockReturnValue(true);
      await runTelemetryOptIn();
      const out = JSON.parse(consoleOutput[0]);
      expect(out).toEqual({ status: 'ok', optedOut: false, alreadyOptedIn: false });
    });
  });

  describe('runTelemetryStatus', () => {
    it('reports source "preference" / disabled when opted out', async () => {
      mockIsTelemetryEnabled.mockReturnValue(false);
      mockIsTelemetryOptedOut.mockReturnValue(true);
      mockGetTelemetrySource.mockReturnValue('preference');
      mockEnvTelemetryOverride.mockReturnValue(undefined);
      await runTelemetryStatus();
      expect(consoleOutput.some((l) => l.includes('disabled'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('saved preference'))).toBe(true);
    });

    it('reports source "env" / enabled when env overrides an opt-out', async () => {
      mockIsTelemetryEnabled.mockReturnValue(true);
      mockIsTelemetryOptedOut.mockReturnValue(true);
      mockGetTelemetrySource.mockReturnValue('env');
      mockEnvTelemetryOverride.mockReturnValue(true);
      await runTelemetryStatus();
      expect(consoleOutput.some((l) => l.includes('enabled'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('environment variable'))).toBe(true);
    });

    it('emits the documented JSON shape', async () => {
      setOutputMode('json');
      mockIsTelemetryEnabled.mockReturnValue(false);
      mockIsTelemetryOptedOut.mockReturnValue(true);
      mockGetTelemetrySource.mockReturnValue('preference');
      mockEnvTelemetryOverride.mockReturnValue(undefined);
      await runTelemetryStatus();
      const out = JSON.parse(consoleOutput[0]);
      expect(out).toEqual({ enabled: false, optedOut: true, source: 'preference', envOverride: null });
    });

    it('serializes a boolean envOverride in JSON', async () => {
      setOutputMode('json');
      mockIsTelemetryEnabled.mockReturnValue(true);
      mockIsTelemetryOptedOut.mockReturnValue(true);
      mockGetTelemetrySource.mockReturnValue('env');
      mockEnvTelemetryOverride.mockReturnValue(true);
      await runTelemetryStatus();
      const out = JSON.parse(consoleOutput[0]);
      expect(out.source).toBe('env');
      expect(out.envOverride).toBe(true);
    });
  });
});
