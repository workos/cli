import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../utils/debug.js', () => ({
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('../utils/environment.js', () => ({
  isNonInteractiveEnvironment: vi.fn(),
}));

vi.mock('node:os', () => ({
  default: { homedir: () => '/tmp/host-probe-test' },
  homedir: () => '/tmp/host-probe-test',
}));

vi.mock('node:fs', () => {
  const promises = {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
  };
  return {
    default: { promises },
    promises,
  };
});

const keyringMock = vi.hoisted(() => ({
  getPassword: vi.fn(() => null),
}));

vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    getPassword(): string | null {
      return keyringMock.getPassword();
    }
  },
}));

import { _resetProbeState, runHostProbe, warnIfSandboxed, observeHostFailure } from './host-probe.js';
import { logWarn } from '../utils/debug.js';
import { isNonInteractiveEnvironment } from '../utils/environment.js';
import { promises as fs } from 'node:fs';

describe('host-probe', () => {
  beforeEach(() => {
    _resetProbeState();
    vi.resetAllMocks();
    keyringMock.getPassword.mockReturnValue(null);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
  });

  describe('runHostProbe', () => {
    it('returns ok when home-fs and keychain succeed', async () => {
      const result = await runHostProbe();
      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('treats a "not found" keychain error as healthy', async () => {
      keyringMock.getPassword.mockImplementation(() => {
        throw new Error('Item not found in keyring');
      });

      const result = await runHostProbe();
      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('detects home-fs failure', async () => {
      vi.mocked(fs.writeFile).mockImplementation(() => {
        throw new Error('EPERM: operation not permitted');
      });

      const result = await runHostProbe();
      expect(result.ok).toBe(false);
      expect(result.failures).toContainEqual(expect.objectContaining({ capability: 'home-fs' }));
    });

    it('does not flag non-permission home-fs errors as sandbox failures', async () => {
      vi.mocked(fs.writeFile).mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      const result = await runHostProbe();
      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('detects keychain failure on permission error', async () => {
      keyringMock.getPassword.mockImplementation(() => {
        throw new Error('EACCES: keychain unavailable');
      });

      const result = await runHostProbe();
      expect(result.ok).toBe(false);
      expect(result.failures).toContainEqual(expect.objectContaining({ capability: 'keychain' }));
    });

    it('caches the result across calls', async () => {
      const first = await runHostProbe();
      const second = await runHostProbe();
      expect(first).toBe(second);
    });
  });

  describe('warnIfSandboxed', () => {
    it('warns in non-interactive mode when probe fails', async () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
      vi.mocked(fs.writeFile).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      await warnIfSandboxed();
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining('unavailable'),
        expect.stringContaining('host shell'),
      );
    });

    it('does not warn in interactive mode', async () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(false);
      vi.mocked(fs.writeFile).mockImplementation(() => {
        throw new Error('EACCES');
      });

      await warnIfSandboxed();
      expect(logWarn).not.toHaveBeenCalled();
    });

    it('warns at most once per session', async () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
      vi.mocked(fs.writeFile).mockImplementation(() => {
        throw new Error('EPERM');
      });

      await warnIfSandboxed();
      const callCount = vi.mocked(logWarn).mock.calls.length;
      await warnIfSandboxed();
      expect(vi.mocked(logWarn).mock.calls.length).toBe(callCount);
    });

    it('does not warn on a healthy host (no false positive when probe entry is absent)', async () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
      keyringMock.getPassword.mockImplementation(() => {
        throw new Error('No such password in the keyring');
      });

      await warnIfSandboxed();
      expect(logWarn).not.toHaveBeenCalled();
    });
  });

  describe('observeHostFailure', () => {
    it('warns on permission errors in non-interactive mode', () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
      observeHostFailure('keychain', new Error('EPERM: operation not permitted'));
      expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('keychain'), expect.stringContaining('host shell'));
    });

    it('ignores non-permission errors', () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
      observeHostFailure('keychain', new Error('JSON parse error'));
      expect(logWarn).not.toHaveBeenCalled();
    });

    it('does not match unrelated words containing "sandbox" as a substring', () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
      observeHostFailure('keychain', new Error('failed to update sandboxes table: schema mismatch'));
      expect(logWarn).not.toHaveBeenCalled();
    });

    it('does not warn twice even for different capabilities', () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
      observeHostFailure('keychain', new Error('EPERM'));
      const callCount = vi.mocked(logWarn).mock.calls.length;
      observeHostFailure('home-fs', new Error('EACCES'));
      expect(vi.mocked(logWarn).mock.calls.length).toBe(callCount);
    });

    it('does not double-warn across proactive and reactive paths', async () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
      vi.mocked(fs.writeFile).mockImplementation(() => {
        throw new Error('EACCES');
      });

      await warnIfSandboxed();
      const callCount = vi.mocked(logWarn).mock.calls.length;
      observeHostFailure('keychain', new Error('EPERM'));
      expect(vi.mocked(logWarn).mock.calls.length).toBe(callCount);
    });
  });
});
