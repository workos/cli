import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe('keyring', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('macOS backend (darwin)', () => {
    const isMac = process.platform === 'darwin';

    it.skipIf(!isMac)('getPassword calls security find-generic-password', async () => {
      const { Entry } = await import('./keyring.js');
      mockedExecFileSync.mockReturnValue('my-secret-password\n');

      const entry = new Entry('test-service', 'test-account');
      const result = entry.getPassword();

      expect(result).toBe('my-secret-password');
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'security',
        ['find-generic-password', '-s', 'test-service', '-a', 'test-account', '-w'],
        expect.objectContaining({ encoding: 'utf-8' }),
      );
    });

    it.skipIf(!isMac)('getPassword returns null when entry not found (exit 44)', async () => {
      const { Entry } = await import('./keyring.js');
      const error = new Error('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.');
      Object.assign(error, { status: 44 });
      mockedExecFileSync.mockImplementation(() => { throw error; });

      const entry = new Entry('test-service', 'test-account');
      expect(entry.getPassword()).toBeNull();
    });

    it.skipIf(!isMac)('getPassword throws on unexpected errors', async () => {
      const { Entry } = await import('./keyring.js');
      const error = new Error('Keychain is locked');
      Object.assign(error, { status: 1 });
      mockedExecFileSync.mockImplementation(() => { throw error; });

      const entry = new Entry('test-service', 'test-account');
      expect(() => entry.getPassword()).toThrow('Keychain is locked');
    });

    it.skipIf(!isMac)('setPassword calls security add-generic-password with -U', async () => {
      const { Entry } = await import('./keyring.js');
      mockedExecFileSync.mockReturnValue(Buffer.from(''));

      const entry = new Entry('test-service', 'test-account');
      entry.setPassword('new-password');

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'security',
        ['add-generic-password', '-U', '-s', 'test-service', '-a', 'test-account', '-w', 'new-password'],
        expect.any(Object),
      );
    });

    it.skipIf(!isMac)('deletePassword calls security delete-generic-password', async () => {
      const { Entry } = await import('./keyring.js');
      mockedExecFileSync.mockReturnValue(Buffer.from(''));

      const entry = new Entry('test-service', 'test-account');
      entry.deletePassword();

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'security',
        ['delete-generic-password', '-s', 'test-service', '-a', 'test-account'],
        expect.any(Object),
      );
    });

    it.skipIf(!isMac)('deletePassword silently succeeds when entry not found (exit 44)', async () => {
      const { Entry } = await import('./keyring.js');
      const error = new Error('Item not found');
      Object.assign(error, { status: 44 });
      mockedExecFileSync.mockImplementation(() => { throw error; });

      const entry = new Entry('test-service', 'test-account');
      expect(() => entry.deletePassword()).not.toThrow();
    });

    it.skipIf(!isMac)('handles service names with special characters safely', async () => {
      const { Entry } = await import('./keyring.js');
      mockedExecFileSync.mockReturnValue('secret\n');

      const entry = new Entry('my-app; rm -rf /', 'user$(whoami)');
      entry.getPassword();

      // Arguments are passed as array elements — no shell interpolation
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'security',
        ['find-generic-password', '-s', 'my-app; rm -rf /', '-a', 'user$(whoami)', '-w'],
        expect.any(Object),
      );
    });
  });

  describe('linux backend', () => {
    const isLinux = process.platform === 'linux';

    it.skipIf(!isLinux)('getPassword calls secret-tool lookup', async () => {
      const { Entry } = await import('./keyring.js');
      mockedExecFileSync.mockReturnValue('my-secret\n');

      const entry = new Entry('test-service', 'test-account');
      const result = entry.getPassword();

      expect(result).toBe('my-secret');
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'secret-tool',
        ['lookup', 'service', 'test-service', 'account', 'test-account'],
        expect.objectContaining({ encoding: 'utf-8' }),
      );
    });

    it.skipIf(!isLinux)('getPassword returns null for empty result', async () => {
      const { Entry } = await import('./keyring.js');
      mockedExecFileSync.mockReturnValue('');

      const entry = new Entry('test-service', 'test-account');
      expect(entry.getPassword()).toBeNull();
    });

    it.skipIf(!isLinux)('setPassword passes password via stdin', async () => {
      const { Entry } = await import('./keyring.js');
      mockedExecFileSync.mockReturnValue(Buffer.from(''));

      const entry = new Entry('test-service', 'test-account');
      entry.setPassword('secret-value');

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'secret-tool',
        ['store', '--label=test-service', 'service', 'test-service', 'account', 'test-account'],
        expect.objectContaining({ input: 'secret-value' }),
      );
    });
  });

  describe('windows backend', () => {
    const isWindows = process.platform === 'win32';

    it.skipIf(!isWindows)('getPassword calls powershell with credential read script', async () => {
      const { Entry } = await import('./keyring.js');
      mockedExecFileSync.mockReturnValue('win-secret');

      const entry = new Entry('test-service', 'test-account');
      const result = entry.getPassword();

      expect(result).toBe('win-secret');
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'powershell',
        expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command']),
        expect.objectContaining({ encoding: 'utf-8' }),
      );
    });

    it.skipIf(!isWindows)('deletePassword calls cmdkey', async () => {
      const { Entry } = await import('./keyring.js');
      mockedExecFileSync.mockReturnValue(Buffer.from(''));

      const entry = new Entry('test-service', 'test-account');
      entry.deletePassword();

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'cmdkey',
        ['/delete:test-service:test-account'],
        expect.any(Object),
      );
    });
  });

  describe('unsupported platform', () => {
    it('throws for unknown platform', async () => {
      if (!['darwin', 'linux', 'win32'].includes(process.platform)) {
        const { Entry } = await import('./keyring.js');
        const entry = new Entry('svc', 'acct');
        expect(() => entry.getPassword()).toThrow(/Unsupported platform/);
      }
    });
  });
});
