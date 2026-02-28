import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./output.js', () => ({
  outputError: vi.fn(),
}));

const { outputError } = await import('./output.js');
const { ExitCode, exitWithCode, exitWithAuthRequired } = await import('./exit-codes.js');

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
  });

  describe('exitWithAuthRequired', () => {
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
  });
});
