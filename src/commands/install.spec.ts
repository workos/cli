import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../run.js', () => ({
  runInstaller: vi.fn(),
}));

// The consolidated setup offer (skills + MCP) now runs behind one consented
// hook. handleInstall just invokes it after a successful install.
vi.mock('./setup.js', () => ({
  maybeRunSetupAfter: vi.fn(),
}));

vi.mock('../utils/ui.js', () => ({
  default: {
    log: { info: vi.fn(), error: vi.fn() },
  },
}));

vi.mock('../utils/output.js', () => ({
  exitWithError: vi.fn(),
  isJsonMode: vi.fn(() => false),
}));

vi.mock('../utils/debug.js', () => ({
  getLogFilePath: vi.fn(() => null),
}));

const { runInstaller } = await import('../run.js');
const { maybeRunSetupAfter } = await import('./setup.js');
const { exitWithError, isJsonMode } = await import('../utils/output.js');
const ui = await import('../utils/ui.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { setInteractionMode, resetInteractionModeForTests } = await import('../utils/interaction-mode.js');

const { handleInstall } = await import('./install.js');

describe('handleInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks resets call history but NOT implementations, so restore the
    // default resolve here — otherwise the "setup offer throws" test's
    // mockRejectedValue leaks into later tests (e.g. the CI-validation cases).
    vi.mocked(maybeRunSetupAfter).mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetInteractionModeForTests();
  });

  it('runs the setup offer after a successful install', async () => {
    vi.mocked(runInstaller).mockResolvedValue(undefined as any);

    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).resolves.toBeUndefined();

    expect(runInstaller).toHaveBeenCalledOnce();
    expect(maybeRunSetupAfter).toHaveBeenCalledWith('install');

    // Order: setup offer runs after the installer.
    const runInstallerOrder = vi.mocked(runInstaller).mock.invocationCallOrder[0];
    const setupOrder = vi.mocked(maybeRunSetupAfter).mock.invocationCallOrder[0];
    expect(setupOrder).toBeGreaterThan(runInstallerOrder);
  });

  it('does not run setup when runInstaller throws', async () => {
    vi.mocked(runInstaller).mockRejectedValue(new Error('install failed'));

    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).rejects.toThrow(CliExit);

    expect(runInstaller).toHaveBeenCalledOnce();
    expect(maybeRunSetupAfter).not.toHaveBeenCalled();
  });

  it('surfaces a CliExit if the setup offer throws (defense in depth)', async () => {
    vi.mocked(runInstaller).mockResolvedValue(undefined as any);
    // In production maybeRunSetupAfter never throws; this tests the outer catch.
    vi.mocked(maybeRunSetupAfter).mockRejectedValue(new Error('setup exploded'));

    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).rejects.toThrow(CliExit);

    expect(runInstaller).toHaveBeenCalledOnce();
    expect(maybeRunSetupAfter).toHaveBeenCalledOnce();
  });

  describe('declined installs (e.g. unsupported framework version)', () => {
    it('carries the structured decline code in JSON mode and exits non-zero', async () => {
      const { InstallDeclinedError } = await import('../lib/installer-errors.js');
      vi.mocked(runInstaller).mockRejectedValue(new InstallDeclinedError('Next.js 14 is unsupported'));
      vi.mocked(isJsonMode).mockReturnValue(true);

      await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).rejects.toThrow(CliExit);

      expect(exitWithError).toHaveBeenCalledWith({
        code: 'unsupported_framework_version',
        message: 'Next.js 14 is unsupported',
      });
    });

    it('exits non-zero without extra output in human mode (guidance already printed)', async () => {
      const { InstallDeclinedError } = await import('../lib/installer-errors.js');
      vi.mocked(runInstaller).mockRejectedValue(new InstallDeclinedError('Next.js 14 is unsupported'));
      vi.mocked(isJsonMode).mockReturnValue(false);

      await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).rejects.toThrow(CliExit);

      expect(exitWithError).not.toHaveBeenCalled();
      expect(ui.default.log.info).not.toHaveBeenCalled();
    });
  });

  describe('CI-mode required-arg validation', () => {
    it('WORKOS_MODE=ci requires --api-key (validation triggered without the --ci flag)', async () => {
      vi.mocked(runInstaller).mockResolvedValue(undefined as any);
      setInteractionMode({ mode: 'ci', source: 'env' });

      await handleInstall({ _: ['install'], $0: 'workos' } as any);

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'missing_args', message: expect.stringContaining('--api-key') }),
      );
    });

    it('WORKOS_MODE=ci with all required args does not error', async () => {
      vi.mocked(runInstaller).mockResolvedValue(undefined as any);
      setInteractionMode({ mode: 'ci', source: 'env' });

      await handleInstall({
        _: ['install'],
        $0: 'workos',
        apiKey: 'sk_test',
        clientId: 'client_x',
        installDir: '/tmp/x',
      } as any);

      expect(exitWithError).not.toHaveBeenCalled();
    });

    it('default (human) mode does not trigger CI validation', async () => {
      vi.mocked(runInstaller).mockResolvedValue(undefined as any);
      await handleInstall({ _: ['install'], $0: 'workos' } as any);

      expect(exitWithError).not.toHaveBeenCalled();
    });
  });
});
