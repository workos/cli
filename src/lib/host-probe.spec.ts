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

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    getPassword() {
      return null;
    }
  },
}));

import { _resetProbeState, runHostProbe, warnIfSandboxed, observeHostFailure } from './host-probe.js';
import { logWarn } from '../utils/debug.js';
import { isNonInteractiveEnvironment } from '../utils/environment.js';
import fs from 'node:fs';

describe('host-probe', () => {
  beforeEach(() => {
    _resetProbeState();
    vi.clearAllMocks();
  });

  describe('runHostProbe', () => {
    it('returns ok when home-fs and keychain succeed', () => {
      const result = runHostProbe();
      expect(result.ok).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('detects home-fs failure', () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('EPERM: operation not permitted');
      });

      const result = runHostProbe();
      expect(result.ok).toBe(false);
      expect(result.failures).toContainEqual(expect.objectContaining({ capability: 'home-fs' }));
    });

    it('caches the result across calls', () => {
      const first = runHostProbe();
      const second = runHostProbe();
      expect(first).toBe(second);
    });
  });

  describe('warnIfSandboxed', () => {
    it('warns in non-interactive mode when probe fails', () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      warnIfSandboxed();
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining('unavailable'),
        expect.stringContaining('host shell'),
      );
    });

    it('does not warn in interactive mode', () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('EACCES');
      });

      warnIfSandboxed();
      expect(logWarn).not.toHaveBeenCalled();
    });

    it('warns at most once per session', () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('EPERM');
      });

      warnIfSandboxed();
      const callCount = vi.mocked(logWarn).mock.calls.length;
      warnIfSandboxed();
      expect(vi.mocked(logWarn).mock.calls.length).toBe(callCount);
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

    it('does not warn twice even for different capabilities', () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
      observeHostFailure('keychain', new Error('EPERM'));
      const callCount = vi.mocked(logWarn).mock.calls.length;
      observeHostFailure('home-fs', new Error('EACCES'));
      expect(vi.mocked(logWarn).mock.calls.length).toBe(callCount);
    });
  });
});
