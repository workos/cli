import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('../utils/git-utils.js', () => ({
  getDefaultBranch: vi.fn(() => 'main'),
  getUncommittedFiles: vi.fn(() => []),
}));

import { execFileSync } from 'node:child_process';
import { stageAndCommit, detectChanges } from './post-install.js';

const mockExecFileSync = vi.mocked(execFileSync);

describe('post-install', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('stageAndCommit', () => {
    it('stages all files and commits with message', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(''));

      stageAndCommit('feat: add WorkOS AuthKit', '/test/dir');

      expect(mockExecFileSync).toHaveBeenCalledWith('git', ['add', '-A'], {
        cwd: '/test/dir',
        stdio: 'ignore',
      });
      expect(mockExecFileSync).toHaveBeenCalledWith('git', ['commit', '-m', 'feat: add WorkOS AuthKit'], {
        cwd: '/test/dir',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    });

    it('throws with stderr when commit fails from pre-commit hook', () => {
      // First call (git add) succeeds
      mockExecFileSync.mockReturnValueOnce(Buffer.from(''));
      // Second call (git commit) fails with hook output
      const error = new Error('Command failed') as Error & {
        stderr: Buffer;
        stdout: Buffer;
      };
      error.stderr = Buffer.from('eslint found 3 errors\nTypeError: missing return type');
      error.stdout = Buffer.from('');
      mockExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      expect(() => stageAndCommit('feat: add WorkOS', '/test/dir')).toThrow(
        /Git commit failed:\neslint found 3 errors/,
      );
    });

    it('includes stdout when stderr is empty', () => {
      mockExecFileSync.mockReturnValueOnce(Buffer.from(''));
      const error = new Error('Command failed') as Error & {
        stderr: Buffer;
        stdout: Buffer;
      };
      error.stderr = Buffer.from('');
      error.stdout = Buffer.from('pre-commit hook failed: formatting check');
      mockExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      expect(() => stageAndCommit('feat: add WorkOS', '/test/dir')).toThrow(
        /Git commit failed:\npre-commit hook failed/,
      );
    });

    it('falls back to error message when no stdio captured', () => {
      mockExecFileSync.mockReturnValueOnce(Buffer.from(''));
      const error = new Error('signal SIGTERM') as Error & {
        stderr?: Buffer;
        stdout?: Buffer;
      };
      mockExecFileSync.mockImplementationOnce(() => {
        throw error;
      });

      expect(() => stageAndCommit('feat: add WorkOS', '/test/dir')).toThrow(/Git commit failed: signal SIGTERM/);
    });
  });

  describe('detectChanges', () => {
    it('returns hasChanges false when no uncommitted files', () => {
      const result = detectChanges();
      expect(result.hasChanges).toBe(false);
      expect(result.files).toEqual([]);
    });
  });
});
