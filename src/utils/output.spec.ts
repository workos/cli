import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockRecordTermination = vi.fn();
vi.mock('./analytics.js', () => ({
  analytics: {
    recordTermination: (...args: unknown[]) => mockRecordTermination(...args),
  },
}));

const {
  resolveOutputMode,
  resolveEffectiveOutputMode,
  setOutputMode,
  getOutputMode,
  isJsonMode,
  outputJson,
  outputError,
  outputSuccess,
  exitWithError,
} = await import('./output.js');

describe('output', () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.WORKOS_FORCE_TTY;
    delete process.env.WORKOS_NO_PROMPT;
    setOutputMode('human');
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    process.env = originalEnv;
  });

  describe('resolveOutputMode', () => {
    it('returns json when --json flag passed', () => {
      expect(resolveOutputMode(true)).toBe('json');
    });

    it('returns human when WORKOS_FORCE_TTY is set even without TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true });
      process.env.WORKOS_FORCE_TTY = '1';
      expect(resolveOutputMode()).toBe('human');
    });

    it('returns json when stdout is not a TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true });
      expect(resolveOutputMode()).toBe('json');
    });

    it('returns json when WORKOS_NO_PROMPT is set for legacy output compatibility', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
      process.env.WORKOS_NO_PROMPT = '1';
      expect(resolveOutputMode()).toBe('json');
    });

    it('returns human when stdout is a TTY and no flags', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
      expect(resolveOutputMode()).toBe('human');
    });

    it('--json flag overrides WORKOS_FORCE_TTY', () => {
      process.env.WORKOS_FORCE_TTY = '1';
      expect(resolveOutputMode(true)).toBe('json');
    });
  });

  describe('resolveEffectiveOutputMode', () => {
    it('keeps human output for human interaction mode', () => {
      expect(resolveEffectiveOutputMode('human', { mode: 'human', source: 'default' })).toBe('human');
    });

    it('forces JSON output for explicit agent mode', () => {
      expect(resolveEffectiveOutputMode('human', { mode: 'agent', source: 'env' })).toBe('json');
    });

    it('preserves non-TTY output compatibility decisions', () => {
      expect(resolveEffectiveOutputMode('human', { mode: 'agent', source: 'non_tty' })).toBe('human');
    });
  });

  describe('setOutputMode / getOutputMode / isJsonMode', () => {
    it('sets and gets output mode', () => {
      setOutputMode('json');
      expect(getOutputMode()).toBe('json');
      expect(isJsonMode()).toBe(true);
    });

    it('defaults to human', () => {
      setOutputMode('human');
      expect(getOutputMode()).toBe('human');
      expect(isJsonMode()).toBe(false);
    });
  });

  describe('outputJson', () => {
    it('writes valid JSON to stdout', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      outputJson({ foo: 'bar', count: 42 });
      expect(spy).toHaveBeenCalledWith('{"foo":"bar","count":42}');
      spy.mockRestore();
    });

    it('handles arrays', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      outputJson([1, 2, 3]);
      expect(spy).toHaveBeenCalledWith('[1,2,3]');
      spy.mockRestore();
    });
  });

  describe('outputError', () => {
    it('writes JSON to stderr in json mode', () => {
      setOutputMode('json');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      outputError({ code: 'test_error', message: 'something failed' });
      const output = spy.mock.calls[0][0];
      expect(JSON.parse(output)).toEqual({
        error: { code: 'test_error', message: 'something failed' },
      });
      spy.mockRestore();
    });

    it('writes plain text to stderr in human mode', () => {
      setOutputMode('human');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      outputError({ code: 'test_error', message: 'something failed' });
      expect(spy.mock.calls[0][0]).toContain('something failed');
      spy.mockRestore();
    });

    it('serializes recovery metadata in json mode', () => {
      setOutputMode('json');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      outputError({
        code: 'auth_required',
        message: 'Not authenticated.',
        recovery: {
          hints: [
            { description: 'Authenticate on host shell.', command: 'workos auth login', hostShellRequired: true },
          ],
        },
      });
      const output = JSON.parse(spy.mock.calls[0][0]);
      expect(output.error.recovery.hints[0]).toEqual({
        description: 'Authenticate on host shell.',
        command: 'workos auth login',
        hostShellRequired: true,
      });
      spy.mockRestore();
    });

    it('prints the first recovery hint in human mode without dumping JSON', () => {
      setOutputMode('human');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      outputError({
        code: 'confirmation_required',
        message: 'Refusing to DELETE.',
        recovery: {
          hints: [{ description: 'Re-run with --yes.', command: 'workos api /x --method DELETE --yes' }],
        },
      });
      const lines = spy.mock.calls.map((c) => c[0]);
      expect(lines.some((l: string) => l.includes('Refusing to DELETE'))).toBe(true);
      expect(lines.some((l: string) => l.includes('workos api /x --method DELETE --yes'))).toBe(true);
      expect(lines.every((l: string) => !l.startsWith('{'))).toBe(true);
      spy.mockRestore();
    });
  });

  describe('outputSuccess', () => {
    it('writes JSON in json mode', () => {
      setOutputMode('json');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      outputSuccess('Created', { id: '123' });
      const output = JSON.parse(spy.mock.calls[0][0]);
      expect(output).toEqual({ status: 'ok', message: 'Created', data: { id: '123' } });
      spy.mockRestore();
    });

    it('writes chalk-formatted text in human mode', () => {
      setOutputMode('human');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      outputSuccess('Created');
      expect(spy.mock.calls[0][0]).toContain('Created');
      spy.mockRestore();
    });
  });

  describe('exitWithError', () => {
    beforeEach(() => {
      mockRecordTermination.mockClear();
    });

    it('writes error and exits with code 1 for unknown codes', () => {
      setOutputMode('json');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      exitWithError({ code: 'bad', message: 'something broke' });

      const output = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(output.error.code).toBe('bad');
      expect(exitSpy).toHaveBeenCalledWith(1);

      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('exits with code 4 for auth_required', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      exitWithError({ code: 'auth_required', message: 'Not logged in' });

      expect(exitSpy).toHaveBeenCalledWith(4);
      expect(mockRecordTermination).toHaveBeenCalledWith('auth_required', 'auth_required');

      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('exits with code 2 for cancelled', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      exitWithError({ code: 'cancelled', message: 'User cancelled' });

      expect(exitSpy).toHaveBeenCalledWith(2);
      expect(mockRecordTermination).toHaveBeenCalledWith('cancelled', 'cancelled');

      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('records validation_error reason for unknown codes', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      exitWithError({ code: 'bad_email', message: 'bad input' });

      expect(mockRecordTermination).toHaveBeenCalledWith('validation_error', 'bad_email');
      expect(exitSpy).toHaveBeenCalledWith(1);

      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('records api_error reason for http_* codes', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      exitWithError({ code: 'http_429', message: 'rate limited' });

      expect(mockRecordTermination).toHaveBeenCalledWith('api_error', 'http_429');
      expect(exitSpy).toHaveBeenCalledWith(1);

      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('writes stderr before recording termination (flush order)', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      exitWithError({ code: 'auth_required', message: 'bye' });

      const stderrOrder = errorSpy.mock.invocationCallOrder[0];
      const terminationOrder = mockRecordTermination.mock.invocationCallOrder[0];
      expect(stderrOrder).toBeLessThan(terminationOrder);

      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });
});
