import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

// Mock child_process.spawn to avoid actually running tsc/build
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
import { runQuickChecks, runTypecheckValidation } from './quick-checks.js';

const mockSpawn = vi.mocked(spawn);

/**
 * Creates a mock process lazily — must be used inside mockImplementationOnce,
 * NOT mockReturnValueOnce, so the setTimeout fires after event listeners attach.
 */
function createMockProcess(exitCode: number, stdout = '', stderr = '') {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  setTimeout(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', exitCode);
  }, 10);

  return proc;
}

describe('runQuickChecks', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'quick-checks-test-'));
    writeFileSync(
      join(testDir, 'package.json'),
      JSON.stringify({
        scripts: { typecheck: 'tsc --noEmit', build: 'next build' },
      }),
    );
    writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
    mockSpawn.mockReset();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns passed=true when both typecheck and build succeed', async () => {
    mockSpawn
      .mockImplementationOnce(() => createMockProcess(0))
      .mockImplementationOnce(() => createMockProcess(0));

    const result = await runQuickChecks(testDir);

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].phase).toBe('typecheck');
    expect(result.results[1].phase).toBe('build');
    expect(result.agentRetryPrompt).toBeNull();
  });

  it('short-circuits build when typecheck fails', async () => {
    const tsError = "src/middleware.ts(42,5): error TS2345: Argument of type 'string | undefined' is not assignable";

    mockSpawn.mockImplementationOnce(() => createMockProcess(1, '', tsError));

    const result = await runQuickChecks(testDir);

    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].phase).toBe('typecheck');
    expect(result.results[0].passed).toBe(false);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('runs build after typecheck passes', async () => {
    mockSpawn
      .mockImplementationOnce(() => createMockProcess(0))
      .mockImplementationOnce(() => createMockProcess(0));

    const result = await runQuickChecks(testDir);

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('skips build when skipBuild option is true', async () => {
    mockSpawn.mockImplementationOnce(() => createMockProcess(0));

    const result = await runQuickChecks(testDir, { skipBuild: true });

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].phase).toBe('typecheck');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('generates agentRetryPrompt when typecheck fails', async () => {
    const tsError = "src/middleware.ts(42,5): error TS2345: Argument of type 'string | undefined' is not assignable to type 'string'.";
    mockSpawn.mockImplementationOnce(() => createMockProcess(1, '', tsError));

    const result = await runQuickChecks(testDir);

    expect(result.agentRetryPrompt).not.toBeNull();
    expect(result.agentRetryPrompt).toContain('typecheck failed');
    expect(result.agentRetryPrompt).toContain('src/middleware.ts');
  });

  it('tracks total duration', async () => {
    mockSpawn
      .mockImplementationOnce(() => createMockProcess(0))
      .mockImplementationOnce(() => createMockProcess(0));

    const result = await runQuickChecks(testDir);

    expect(typeof result.totalDurationMs).toBe('number');
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports build failure when typecheck passes but build fails', async () => {
    mockSpawn
      .mockImplementationOnce(() => createMockProcess(0)) // typecheck pass
      .mockImplementationOnce(() => createMockProcess(1, '', 'Error: Build failed')); // build fail

    const result = await runQuickChecks(testDir);

    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].passed).toBe(true);
    expect(result.results[1].passed).toBe(false);
    expect(result.results[1].phase).toBe('build');
    expect(result.agentRetryPrompt).toContain('build failed');
  });
});

describe('runTypecheckValidation', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'typecheck-test-'));
    writeFileSync(
      join(testDir, 'package.json'),
      JSON.stringify({
        scripts: { typecheck: 'tsc --noEmit' },
      }),
    );
    writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
    mockSpawn.mockReset();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns passed=true when typecheck succeeds', async () => {
    mockSpawn.mockImplementationOnce(() => createMockProcess(0));

    const result = await runTypecheckValidation(testDir);

    expect(result.passed).toBe(true);
    expect(result.phase).toBe('typecheck');
    expect(result.issues).toHaveLength(0);
    expect(result.agentPrompt).toBeNull();
  });

  it('parses TypeScript errors from output', async () => {
    const tsError =
      "src/middleware.ts(42,5): error TS2345: Argument of type 'string | undefined' is not assignable to type 'string'.";
    mockSpawn.mockImplementationOnce(() => createMockProcess(1, '', tsError));

    const result = await runTypecheckValidation(testDir);

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].message).toContain('Type error');
    expect(result.issues[0].severity).toBe('error');
  });

  it('formats errors into actionable agent prompt', async () => {
    const tsError =
      "src/middleware.ts(42,5): error TS2345: Argument of type 'string | undefined' is not assignable to type 'string'.";
    mockSpawn.mockImplementationOnce(() => createMockProcess(1, '', tsError));

    const result = await runTypecheckValidation(testDir);

    expect(result.agentPrompt).not.toBeNull();
    expect(result.agentPrompt).toContain('src/middleware.ts');
    expect(result.agentPrompt).toContain('not assignable');
  });

  it('handles pretty-printed tsc errors (colon-separated format)', async () => {
    const tsError =
      "src/app.tsx:10:3 - error TS2322: Type 'number' is not assignable to type 'string'.";
    mockSpawn.mockImplementationOnce(() => createMockProcess(1, tsError, ''));

    const result = await runTypecheckValidation(testDir);

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('provides fallback message when errors cannot be parsed', async () => {
    mockSpawn.mockImplementationOnce(() =>
      createMockProcess(1, '', 'Some unknown error format that we cannot parse'),
    );

    const result = await runTypecheckValidation(testDir);

    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toBe('Typecheck failed');
  });

  it('uses typecheck script from package.json when available', async () => {
    mockSpawn.mockImplementationOnce(() => createMockProcess(0));

    await runTypecheckValidation(testDir);

    expect(mockSpawn).toHaveBeenCalledWith(
      'pnpm',
      ['typecheck'],
      expect.objectContaining({ cwd: testDir }),
    );
  });

  it('falls back to npx tsc --noEmit when no typecheck script', async () => {
    writeFileSync(
      join(testDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'next build' } }),
    );
    mockSpawn.mockImplementationOnce(() => createMockProcess(0));

    await runTypecheckValidation(testDir);

    expect(mockSpawn).toHaveBeenCalledWith(
      'npx',
      ['tsc', '--noEmit'],
      expect.objectContaining({ cwd: testDir }),
    );
  });

  it('detects type-check script (hyphenated variant)', async () => {
    writeFileSync(
      join(testDir, 'package.json'),
      JSON.stringify({ scripts: { 'type-check': 'tsc --noEmit' } }),
    );
    mockSpawn.mockImplementationOnce(() => createMockProcess(0));

    await runTypecheckValidation(testDir);

    expect(mockSpawn).toHaveBeenCalledWith(
      'pnpm',
      ['type-check'],
      expect.objectContaining({ cwd: testDir }),
    );
  });

  it('tracks duration', async () => {
    mockSpawn.mockImplementationOnce(() => createMockProcess(0));

    const result = await runTypecheckValidation(testDir);

    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
