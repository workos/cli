import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import os from 'node:os';

const mockCaptureUnhandledCrash = vi.fn();

vi.mock('./analytics.js', () => ({
  analytics: {
    captureUnhandledCrash: (...args: unknown[]) => mockCaptureUnhandledCrash(...args),
  },
}));

describe('crash-reporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('sanitizeStack', () => {
    let sanitizeStack: typeof import('./crash-reporter.js').sanitizeStack;

    beforeEach(async () => {
      const mod = await import('./crash-reporter.js');
      sanitizeStack = mod.sanitizeStack;
    });

    it('returns empty string for undefined', () => {
      expect(sanitizeStack(undefined)).toBe('');
    });

    it('replaces home directory with ~', () => {
      const home = os.homedir();
      const stack = `Error: test\n    at ${home}/project/src/index.ts:1:1`;
      expect(sanitizeStack(stack)).toContain('~');
      expect(sanitizeStack(stack)).not.toContain(home);
    });

    it('strips absolute paths to node_modules/dist/src', () => {
      const stack = 'Error\n    at /long/absolute/path/to/src/file.ts:1:1';
      const result = sanitizeStack(stack);
      expect(result).toContain('src/');
      expect(result).not.toContain('/long/absolute/path/to/');
    });

    it('truncates stacks longer than 4096 chars', () => {
      const longStack = 'Error: test\n' + 'x'.repeat(5000);
      const result = sanitizeStack(longStack);
      expect(result.length).toBeLessThanOrEqual(4096 + '\n...[truncated]'.length);
      expect(result).toContain('...[truncated]');
    });

    it('does not truncate short stacks', () => {
      const shortStack = 'Error: test\n    at file.ts:1:1';
      const result = sanitizeStack(shortStack);
      expect(result).toBe(shortStack);
      expect(result).not.toContain('truncated');
    });
  });

  describe('installCrashReporter', () => {
    let processOnSpy: ReturnType<typeof vi.spyOn>;
    let processExitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      processOnSpy = vi.spyOn(process, 'on');
      processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    });

    afterEach(() => {
      processOnSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('registers uncaughtException and unhandledRejection handlers', async () => {
      const { installCrashReporter } = await import('./crash-reporter.js');
      installCrashReporter();

      const eventNames = processOnSpy.mock.calls.map((call) => call[0]);
      expect(eventNames).toContain('uncaughtException');
      expect(eventNames).toContain('unhandledRejection');
    });

    it('uncaughtException handler queues crash event and exits', async () => {
      const { installCrashReporter } = await import('./crash-reporter.js');
      installCrashReporter();

      const uncaughtHandler = processOnSpy.mock.calls.find((c) => c[0] === 'uncaughtException')?.[1] as (
        err: Error,
      ) => void;

      const error = new Error('boom');
      uncaughtHandler(error);

      expect(mockCaptureUnhandledCrash).toHaveBeenCalledTimes(1);
      const capturedError = mockCaptureUnhandledCrash.mock.calls[0][0];
      expect(capturedError.message).toBe('boom');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('unhandledRejection handler wraps non-Error reasons', async () => {
      const { installCrashReporter } = await import('./crash-reporter.js');
      installCrashReporter();

      const rejectionHandler = processOnSpy.mock.calls.find((c) => c[0] === 'unhandledRejection')?.[1] as (
        reason: unknown,
      ) => void;

      rejectionHandler('string reason');

      expect(mockCaptureUnhandledCrash).toHaveBeenCalledTimes(1);
      const capturedError = mockCaptureUnhandledCrash.mock.calls[0][0];
      expect(capturedError.message).toBe('string reason');
    });

    it('isCrashing guard prevents recursive handling', async () => {
      // Simulate the crash handler being called, then itself crashing
      mockCaptureUnhandledCrash.mockImplementationOnce(() => {
        // First call succeeds
      });

      const { installCrashReporter } = await import('./crash-reporter.js');
      installCrashReporter();

      const uncaughtHandler = processOnSpy.mock.calls.find((c) => c[0] === 'uncaughtException')?.[1] as (
        err: Error,
      ) => void;

      // First call sets isCrashing
      uncaughtHandler(new Error('first'));
      // Second call should be guarded (module-level isCrashing = true)
      uncaughtHandler(new Error('second'));

      // Only first call should have reached analytics
      expect(mockCaptureUnhandledCrash).toHaveBeenCalledTimes(1);
    });

    it('handlers are synchronous (no async in the critical path)', async () => {
      const { installCrashReporter } = await import('./crash-reporter.js');
      installCrashReporter();

      const uncaughtHandler = processOnSpy.mock.calls.find((c) => c[0] === 'uncaughtException')?.[1] as (
        err: Error,
      ) => void;

      // Verify the handler returns void, not a Promise
      const result = uncaughtHandler(new Error('sync test'));
      expect(result).toBeUndefined();
    });
  });
});
