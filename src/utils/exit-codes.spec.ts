import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./output.js', () => ({
  outputError: vi.fn(),
}));

const { outputError } = await import('./output.js');
const { ExitCode, exitWithCode, exitWithAuthRequired, resolveErrorCode } = await import('./exit-codes.js');
const { setInteractionMode, resetInteractionModeForTests } = await import('./interaction-mode.js');
const { CliExit } = await import('./cli-exit.js');

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
    it('throws CliExit with the given code', () => {
      expect(() => exitWithCode(ExitCode.GENERAL_ERROR)).toThrow(CliExit);
      try {
        exitWithCode(ExitCode.GENERAL_ERROR);
      } catch (e) {
        expect((e as InstanceType<typeof CliExit>).exitCode).toBe(1);
      }
    });

    it('writes error before throwing when error provided', () => {
      try {
        exitWithCode(ExitCode.AUTH_REQUIRED, { code: 'auth_required', message: 'Not logged in' });
      } catch (e) {
        expect(e).toBeInstanceOf(CliExit);
        expect((e as InstanceType<typeof CliExit>).exitCode).toBe(4);
      }
      expect(outputError).toHaveBeenCalledWith({ code: 'auth_required', message: 'Not logged in' });
    });

    it('does not write error when none provided', () => {
      try {
        exitWithCode(ExitCode.SUCCESS);
      } catch (e) {
        expect(e).toBeInstanceOf(CliExit);
        expect((e as InstanceType<typeof CliExit>).exitCode).toBe(0);
      }
      expect(outputError).not.toHaveBeenCalled();
    });

    it('includes termination reason derived from exit code in context', () => {
      try {
        exitWithCode(ExitCode.CANCELLED);
      } catch (e) {
        expect((e as InstanceType<typeof CliExit>).context?.reason).toBe('cancelled');
      }

      try {
        exitWithCode(ExitCode.AUTH_REQUIRED);
      } catch (e) {
        expect((e as InstanceType<typeof CliExit>).context?.reason).toBe('auth_required');
      }

      try {
        exitWithCode(ExitCode.GENERAL_ERROR);
      } catch (e) {
        expect((e as InstanceType<typeof CliExit>).context?.reason).toBe('validation_error');
      }

      try {
        exitWithCode(ExitCode.SUCCESS);
      } catch (e) {
        expect((e as InstanceType<typeof CliExit>).context?.reason).toBe('success');
      }
    });

    it('forwards error.code to context.errorCode when error provided', () => {
      try {
        exitWithCode(ExitCode.GENERAL_ERROR, { code: 'bad_email', message: 'bad' });
      } catch (e) {
        expect((e as InstanceType<typeof CliExit>).context?.reason).toBe('validation_error');
        expect((e as InstanceType<typeof CliExit>).context?.errorCode).toBe('bad_email');
      }
    });
  });

  describe('exitWithAuthRequired', () => {
    afterEach(() => resetInteractionModeForTests());

    it('throws CliExit with code 4 and auth_required error', () => {
      try {
        exitWithAuthRequired();
      } catch (e) {
        expect(e).toBeInstanceOf(CliExit);
        expect((e as InstanceType<typeof CliExit>).exitCode).toBe(4);
      }
      expect(outputError).toHaveBeenCalledWith(expect.objectContaining({ code: 'auth_required' }));
    });

    it('uses custom message when provided', () => {
      try {
        exitWithAuthRequired('Custom auth message');
      } catch {
        // expected
      }
      expect(outputError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'auth_required', message: 'Custom auth message' }),
      );
    });

    it('attaches agent-mode recovery hints by default', () => {
      setInteractionMode({ mode: 'agent', source: 'env' });
      try {
        exitWithAuthRequired();
      } catch {
        // expected
      }
      const call = vi.mocked(outputError).mock.calls.at(-1)![0];
      expect(call.recovery?.hints[0]).toMatchObject({
        command: expect.stringContaining('auth login'),
        hostShellRequired: true,
      });
    });

    it('attaches CI-mode recovery hints when in CI', () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      try {
        exitWithAuthRequired();
      } catch {
        // expected
      }
      const call = vi.mocked(outputError).mock.calls.at(-1)![0];
      expect(call.recovery?.hints[0].description).toMatch(/WORKOS_API_KEY/);
      expect(call.recovery?.hints[0].command).toBeUndefined();
    });

    it('sets context.reason to auth_required with error.code in context', () => {
      try {
        exitWithAuthRequired();
      } catch (e) {
        expect((e as InstanceType<typeof CliExit>).context?.reason).toBe('auth_required');
        expect((e as InstanceType<typeof CliExit>).context?.errorCode).toBe('auth_required');
      }
    });
  });
});
