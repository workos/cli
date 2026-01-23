import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Create test directory before mocking
const testDir = mkdtempSync(join(tmpdir(), 'wizard-test-'));

// Mock homedir to use temp directory
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return { ...actual, homedir: () => testDir };
});

// Mock clack to avoid side effects
vi.mock('./clack.js', () => ({
  default: {
    log: { info: vi.fn() },
  },
}));

describe('debug logging', () => {
  afterEach(() => {
    vi.resetModules();
  });

  // Clean up after all tests
  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures
    }
  });

  it('creates log file on init', async () => {
    const { initLogFile, getLogFilePath } = await import('./debug.js');

    initLogFile();
    const path = getLogFilePath();

    expect(path).toBeTruthy();
    expect(path).toContain('.workos-installer/logs/wizard-');
  });

  it('rotates old log files keeping max 10', async () => {
    // Create the logs directory
    const logsDir = join(testDir, '.workos-installer', 'logs');
    mkdirSync(logsDir, { recursive: true });

    // Create 12 fake log files with timestamps that sort correctly
    for (let i = 0; i < 12; i++) {
      const day = i.toString().padStart(2, '0');
      writeFileSync(join(logsDir, `wizard-2024-01-${day}T00-00-00.000Z.log`), '');
    }

    // Import fresh module
    vi.resetModules();
    vi.doMock('os', async () => {
      const actual = await vi.importActual('os');
      return { ...actual, homedir: () => testDir };
    });
    vi.doMock('./clack.js', () => ({
      default: { log: { info: vi.fn() } },
    }));

    const { initLogFile } = await import('./debug.js');
    initLogFile();

    const files = readdirSync(logsDir).filter((f) => f.startsWith('wizard-') && f.endsWith('.log'));
    expect(files.length).toBe(10);
  });

  it('writes severity prefixes', async () => {
    const { initLogFile, getLogFilePath, logInfo, logWarn, logError } = await import('./debug.js');

    initLogFile();
    logInfo('test info');
    logWarn('test warn');
    logError('test error');

    const logPath = getLogFilePath();
    expect(logPath).toBeTruthy();

    const content = readFileSync(logPath!, 'utf-8');
    expect(content).toContain('ℹ️  INFO: test info');
    expect(content).toContain('⚠️  WARN: test warn');
    expect(content).toContain('❌ ERROR: test error');
  });

  it('getLogFilePath returns null before init', async () => {
    vi.resetModules();
    vi.doMock('os', async () => {
      const actual = await vi.importActual('os');
      return { ...actual, homedir: () => testDir };
    });
    vi.doMock('./clack.js', () => ({
      default: { log: { info: vi.fn() } },
    }));

    const { getLogFilePath } = await import('./debug.js');
    expect(getLogFilePath()).toBeNull();
  });
});
