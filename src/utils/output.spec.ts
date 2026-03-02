import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  resolveOutputMode,
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

    it('returns human when stdout is a TTY and no flags', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
      expect(resolveOutputMode()).toBe('human');
    });

    it('--json flag overrides WORKOS_FORCE_TTY', () => {
      process.env.WORKOS_FORCE_TTY = '1';
      expect(resolveOutputMode(true)).toBe('json');
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
    it('writes error and exits with code 1', () => {
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
  });
});
