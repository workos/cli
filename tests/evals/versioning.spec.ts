import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureVersionMetadata, getFileHash } from './versioning.js';

// Mock exec-file to avoid actual git calls in tests
vi.mock('../../src/utils/exec-file.js', () => ({
  execFileNoThrow: vi.fn(),
}));

// Mock settings
vi.mock('../../src/lib/settings.js', () => ({
  getVersion: vi.fn(() => '1.2.3'),
  getConfig: vi.fn(() => ({ model: 'claude-opus-4-5-20251101' })),
}));

import { execFileNoThrow } from '../../src/utils/exec-file.js';

describe('versioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getFileHash', () => {
    it('returns short hash when git succeeds', async () => {
      vi.mocked(execFileNoThrow).mockResolvedValue({
        status: 0,
        stdout: 'abc123def456789\n',
        stderr: '',
      });

      const hash = await getFileHash('test/file.ts');

      expect(hash).toBe('abc123de'); // First 8 chars
      expect(execFileNoThrow).toHaveBeenCalledWith('git', ['hash-object', 'test/file.ts'], expect.any(Object));
    });

    it('returns "unknown" when git fails', async () => {
      vi.mocked(execFileNoThrow).mockResolvedValue({
        status: 128,
        stdout: '',
        stderr: 'fatal: not a git repository',
      });

      const hash = await getFileHash('test/file.ts');

      expect(hash).toBe('unknown');
    });

    it('returns "unknown" when file not found', async () => {
      vi.mocked(execFileNoThrow).mockResolvedValue({
        status: 128,
        stdout: '',
        stderr: 'fatal: Cannot open',
      });

      const hash = await getFileHash('nonexistent.ts');

      expect(hash).toBe('unknown');
    });
  });

  describe('captureVersionMetadata', () => {
    it('returns all required fields', async () => {
      vi.mocked(execFileNoThrow).mockResolvedValue({
        status: 0,
        stdout: '12345678abcdef\n',
        stderr: '',
      });

      const metadata = await captureVersionMetadata();

      expect(metadata.cliVersion).toBe('1.2.3');
      expect(metadata.modelVersion).toBe('claude-opus-4-5-20251101');
      expect(metadata.skillVersions).toBeDefined();
      expect(typeof metadata.skillVersions.nextjs).toBe('string');
      expect(typeof metadata.skillVersions.react).toBe('string');
      expect(typeof metadata.skillVersions['react-router']).toBe('string');
      expect(typeof metadata.skillVersions['tanstack-start']).toBe('string');
      expect(typeof metadata.skillVersions['vanilla-js']).toBe('string');
    });

    it('captures hashes for all frameworks', async () => {
      let callCount = 0;
      vi.mocked(execFileNoThrow).mockImplementation(async () => {
        callCount++;
        return {
          status: 0,
          stdout: `hash${callCount}000000\n`,
          stderr: '',
        };
      });

      const metadata = await captureVersionMetadata();

      // Should have called git hash-object for each framework
      expect(execFileNoThrow).toHaveBeenCalledTimes(5);
      expect(Object.keys(metadata.skillVersions)).toHaveLength(5);
    });

    it('handles mixed success/failure gracefully', async () => {
      vi.mocked(execFileNoThrow).mockImplementation(async (_cmd, args) => {
        const path = args[1] as string;
        if (path.includes('nextjs')) {
          return { status: 0, stdout: 'abc12345\n', stderr: '' };
        }
        return { status: 128, stdout: '', stderr: 'not found' };
      });

      const metadata = await captureVersionMetadata();

      expect(metadata.skillVersions.nextjs).toBe('abc12345');
      expect(metadata.skillVersions.react).toBe('unknown');
    });
  });
});
