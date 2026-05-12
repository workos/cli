import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./output.js', () => ({
  outputError: vi.fn(),
}));

const mockRecordTermination = vi.fn();
vi.mock('./analytics.js', () => ({
  analytics: {
    recordTermination: (...args: unknown[]) => mockRecordTermination(...args),
  },
}));

const { outputError } = await import('./output.js');
const { ExitCode, exitWithCode, exitWithAuthRequired, resolveErrorCode } = await import('./exit-codes.js');
const { setInteractionMode, resetInteractionModeForTests } = await import('./interaction-mode.js');

describe('exit-codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ExitCode constants', () => {
    it('has correct values', () => {
      expect(ExitCode.SUCCESS).toBe(0);
      expect(ExitCode.GENERAL_ERROR).toBe(1);
      expect(ExitCode.CANCELLED).toBe(2);
      expect(ExitCode.AUTH_REQUIRED).toBe(4);
    });
  });

  describe('resolveErrorCode', () => {
    it('maps auth_required to exit 4', () => {
      expect(resolveErrorCode('auth_required')).toEqual({
        reason: 'auth_required',
        exit: ExitCode.AUTH_REQUIRED,
      });
    });

    it('maps cancelled to exit 2', () => {
      expect(resolveErrorCode('cancelled')).toEqual({
        reason: 'cancelled',
        exit: ExitCode.CANCELLED,
      });
    });

    it('does not hard-classify not_found / unknown_error as api_error', () => {
      // These codes are reused for non-API local errors (e.g. env.ts missing
      // config). API failures signal via `apiContext` on `exitWithError` so
      // `resolveErrorCode` falls back to `validation_error` here.
      expect(resolveErrorCode('not_found')).toEqual({
        reason: 'validation_error',
        exit: ExitCode.GENERAL_ERROR,
      });
      expect(resolveErrorCode('unknown_error')).toEqual({
        reason: 'validation_error',
        exit: ExitCode.GENERAL_ERROR,
      });
    });

    it('maps http_* prefixed codes to api_error + exit 1', () => {
      expect(resolveErrorCode('http_401')).toEqual({
        reason: 'api_error',
        exit: ExitCode.GENERAL_ERROR,
      });
      expect(resolveErrorCode('http_500')).toEqual({
        reason: 'api_error',
        exit: ExitCode.GENERAL_ERROR,
      });
    });

    it('falls back to validation_error + exit 1 for unknown codes', () => {
      expect(resolveErrorCode('bad_email')).toEqual({
        reason: 'validation_error',
        exit: ExitCode.GENERAL_ERROR,
      });
      expect(resolveErrorCode('')).toEqual({
        reason: 'validation_error',
        exit: ExitCode.GENERAL_ERROR,
      });
    });
  });

  describe('exitWithCode', () => {
    it('exits with the given code', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      exitWithCode(ExitCode.GENERAL_ERROR);
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });

    it('writes error before exiting when error provided', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      exitWithCode(ExitCode.AUTH_REQUIRED, { code: 'auth_required', message: 'Not logged in' });
      expect(outputError).toHaveBeenCalledWith({ code: 'auth_required', message: 'Not logged in' });
      expect(exitSpy).toHaveBeenCalledWith(4);
      exitSpy.mockRestore();
    });

    it('does not write error when none provided', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      exitWithCode(ExitCode.SUCCESS);
      expect(outputError).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
    });

    it('records termination reason derived from exit code before exiting', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      exitWithCode(ExitCode.CANCELLED);
      expect(mockRecordTermination).toHaveBeenCalledWith('cancelled', undefined);

      mockRecordTermination.mockClear();
      exitWithCode(ExitCode.AUTH_REQUIRED);
      expect(mockRecordTermination).toHaveBeenCalledWith('auth_required', undefined);

      mockRecordTermination.mockClear();
      exitWithCode(ExitCode.GENERAL_ERROR);
      expect(mockRecordTermination).toHaveBeenCalledWith('validation_error', undefined);

      mockRecordTermination.mockClear();
      exitWithCode(ExitCode.SUCCESS);
      expect(mockRecordTermination).toHaveBeenCalledWith('success', undefined);

      exitSpy.mockRestore();
    });

    it('forwards error.code to recordTermination when error provided', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      exitWithCode(ExitCode.GENERAL_ERROR, { code: 'bad_email', message: 'bad' });
      expect(mockRecordTermination).toHaveBeenCalledWith('validation_error', 'bad_email');

      exitSpy.mockRestore();
    });
  });

  describe('exitWithAuthRequired', () => {
    afterEach(() => resetInteractionModeForTests());

    it('exits with code 4 and auth_required error', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      exitWithAuthRequired();
      expect(outputError).toHaveBeenCalledWith(expect.objectContaining({ code: 'auth_required' }));
      expect(exitSpy).toHaveBeenCalledWith(4);
      exitSpy.mockRestore();
    });

    it('uses custom message when provided', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      exitWithAuthRequired('Custom auth message');
      expect(outputError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'auth_required', message: 'Custom auth message' }),
      );
      exitSpy.mockRestore();
    });

    it('attaches agent-mode recovery hints by default', () => {
      setInteractionMode({ mode: 'agent', source: 'env' });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      exitWithAuthRequired();
      const call = vi.mocked(outputError).mock.calls.at(-1)![0];
      expect(call.recovery?.hints[0]).toMatchObject({
        command: expect.stringContaining('auth login'),
        hostShellRequired: true,
      });
      exitSpy.mockRestore();
    });

    it('attaches CI-mode recovery hints when in CI', () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      exitWithAuthRequired();
      const call = vi.mocked(outputError).mock.calls.at(-1)![0];
      expect(call.recovery?.hints[0].description).toMatch(/WORKOS_API_KEY/);
      expect(call.recovery?.hints[0].command).toBeUndefined();
      exitSpy.mockRestore();
    });

    it('records termination reason auth_required with error.code before exit', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      exitWithAuthRequired();
      expect(mockRecordTermination).toHaveBeenCalledWith('auth_required', 'auth_required');
      exitSpy.mockRestore();
    });
  });
});
