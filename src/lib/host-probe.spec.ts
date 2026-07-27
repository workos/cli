import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../utils/debug.js', () => ({
  logWarn: vi.fn(),
  logVisibleWarn: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('../utils/interaction-mode.js', () => ({
  isAgentMode: vi.fn(),
  isCiMode: vi.fn(),
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
import { logInfo, logVisibleWarn } from '../utils/debug.js';
import { isAgentMode, isCiMode } from '../utils/interaction-mode.js';
import { promises as fs } from 'node:fs';

describe('host-probe', () => {
  beforeEach(() => {
    _resetProbeState();
    vi.resetAllMocks();
    keyringMock.getPassword.mockReturnValue(null);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
    vi.mocked(isAgentMode).mockReturnValue(false);
    vi.mocked(isCiMode).mockReturnValue(false);
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

    it('reports success even when unlink cleanup fails', async () => {
      vi.mocked(fs.unlink).mockRejectedValue(new Error('EACCES: permission denied'));

      const result = await runHostProbe();
      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('always attempts to unlink the probe file after a successful write', async () => {
      await runHostProbe();
      expect(vi.mocked(fs.unlink)).toHaveBeenCalledTimes(1);
    });

    it('detects keychain failure on permission error', async () => {
      keyringMock.getPassword.mockImplementation(() => {
        throw new Error('EACCES: keychain unavailable');
      });

      const result = await runHostProbe();
      expect(result.ok).toBe(false);
      expect(result.failures).toContainEqual(expect.objectContaining({ capability: 'keychain' }));
    });

    it('does not flag non-permission keychain errors as sandbox failures', async () => {
      keyringMock.getPassword.mockImplementation(() => {
        throw new Error('The user canceled the Keychain Services operation');
      });

      const result = await runHostProbe();
      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('caches the result across calls', async () => {
      const first = await runHostProbe();
      const second = await runHostProbe();
      expect(first).toBe(second);
    });
  });

  describe('warnIfSandboxed', () => {
    it('warns in agent mode when probe fails', async () => {
      vi.mocked(isAgentMode).mockReturnValue(true);
      vi.mocked(fs.writeFile).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      await warnIfSandboxed();
      expect(logVisibleWarn).toHaveBeenCalledWith(
        expect.stringContaining('unavailable'),
        expect.stringContaining('host shell'),
      );
    });

    it('does not warn in human mode', async () => {
      vi.mocked(isAgentMode).mockReturnValue(false);
      vi.mocked(isCiMode).mockReturnValue(false);
      vi.mocked(fs.writeFile).mockImplementation(() => {
        throw new Error('EACCES');
      });

      await warnIfSandboxed();
      expect(logVisibleWarn).not.toHaveBeenCalled();
    });

    it('warns at most once per session', async () => {
      vi.mocked(isAgentMode).mockReturnValue(true);
      vi.mocked(fs.writeFile).mockImplementation(() => {
        throw new Error('EPERM');
      });

      await warnIfSandboxed();
      const callCount = vi.mocked(logVisibleWarn).mock.calls.length;
      await warnIfSandboxed();
      expect(vi.mocked(logVisibleWarn).mock.calls.length).toBe(callCount);
    });

    it('does not warn on a healthy host (no false positive when probe entry is absent)', async () => {
      vi.mocked(isAgentMode).mockReturnValue(true);
      keyringMock.getPassword.mockImplementation(() => {
        throw new Error('No such password in the keyring');
      });

      await warnIfSandboxed();
      expect(logVisibleWarn).not.toHaveBeenCalled();
    });

    it('warns in CI mode when probe fails', async () => {
      vi.mocked(isCiMode).mockReturnValue(true);
      vi.mocked(fs.writeFile).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      await warnIfSandboxed();
      expect(logVisibleWarn).toHaveBeenCalledWith(
        expect.stringContaining('unavailable'),
        expect.stringContaining('host shell'),
      );
    });
  });

  describe('observeHostFailure', () => {
    it('warns on permission errors in agent mode', () => {
      vi.mocked(isAgentMode).mockReturnValue(true);
      observeHostFailure('keychain', new Error('EPERM: operation not permitted'), {
        operation: 'read',
        target: 'workos-cli/credentials',
        label: 'credential keychain entry',
      });
      expect(logVisibleWarn).toHaveBeenCalledWith(
        expect.stringContaining('keychain'),
        expect.stringContaining('host shell'),
      );
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('credential keychain entry'));
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('operation=read'));
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('target=workos-cli/credentials'));
    });

    it('warns on browser launch errors in agent mode', () => {
      vi.mocked(isAgentMode).mockReturnValue(true);
      observeHostFailure('browser-launch', new Error('No browser available'), {
        operation: 'open',
        target: 'https://example.com',
        label: 'auth login browser',
      });
      expect(logVisibleWarn).toHaveBeenCalledWith(
        expect.stringContaining('browser-launch'),
        expect.stringContaining('host shell'),
      );
    });

    it('ignores non-permission errors', () => {
      vi.mocked(isAgentMode).mockReturnValue(true);
      observeHostFailure('keychain', new Error('JSON parse error'));
      expect(logVisibleWarn).not.toHaveBeenCalled();
    });

    it('does not match unrelated words containing "sandbox" as a substring', () => {
      vi.mocked(isAgentMode).mockReturnValue(true);
      observeHostFailure('keychain', new Error('failed to update sandboxes table: schema mismatch'));
      expect(logVisibleWarn).not.toHaveBeenCalled();
    });

    it('does not warn twice even for different capabilities', () => {
      vi.mocked(isAgentMode).mockReturnValue(true);
      observeHostFailure('keychain', new Error('EPERM'));
      const callCount = vi.mocked(logVisibleWarn).mock.calls.length;
      observeHostFailure('home-fs', new Error('EACCES'));
      expect(vi.mocked(logVisibleWarn).mock.calls.length).toBe(callCount);
    });

    it('does not double-warn across proactive and reactive paths', async () => {
      vi.mocked(isAgentMode).mockReturnValue(true);
      vi.mocked(fs.writeFile).mockImplementation(() => {
        throw new Error('EACCES');
      });

      await warnIfSandboxed();
      const callCount = vi.mocked(logVisibleWarn).mock.calls.length;
      observeHostFailure('keychain', new Error('EPERM'));
      expect(vi.mocked(logVisibleWarn).mock.calls.length).toBe(callCount);
    });
  });
});
