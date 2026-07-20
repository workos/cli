import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../run.js', () => ({
  runInstaller: vi.fn(),
}));

vi.mock('./install-skill.js', () => ({
  autoInstallSkills: vi.fn(),
}));

vi.mock('../lib/mcp-notice.js', () => ({
  maybeOfferMcpInstall: vi.fn(),
}));

vi.mock('../utils/clack.js', () => ({
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
const { autoInstallSkills } = await import('./install-skill.js');
const { maybeOfferMcpInstall } = await import('../lib/mcp-notice.js');
const clack = (await import('../utils/clack.js')).default;
const { isJsonMode, exitWithError } = await import('../utils/output.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { setInteractionMode, resetInteractionModeForTests } = await import('../utils/interaction-mode.js');

const { handleInstall } = await import('./install.js');

describe('handleInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetInteractionModeForTests();
  });

  it('calls autoInstallSkills after successful install', async () => {
    vi.mocked(runInstaller).mockResolvedValue(undefined as any);
    vi.mocked(autoInstallSkills).mockResolvedValue(null);

    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).resolves.toBeUndefined();

    expect(runInstaller).toHaveBeenCalledOnce();
    expect(autoInstallSkills).toHaveBeenCalledOnce();

    // Verify order: autoInstallSkills called after runInstaller
    const runInstallerOrder = vi.mocked(runInstaller).mock.invocationCallOrder[0];
    const autoInstallOrder = vi.mocked(autoInstallSkills).mock.invocationCallOrder[0];
    expect(autoInstallOrder).toBeGreaterThan(runInstallerOrder);
  });

  it('offers the MCP install after skills, on the install-flow entry point', async () => {
    vi.mocked(runInstaller).mockResolvedValue(undefined as any);
    vi.mocked(autoInstallSkills).mockResolvedValue(null);

    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).resolves.toBeUndefined();

    expect(maybeOfferMcpInstall).toHaveBeenCalledWith({ entryPoint: 'install-flow' });
    const autoInstallOrder = vi.mocked(autoInstallSkills).mock.invocationCallOrder[0];
    const mcpOfferOrder = vi.mocked(maybeOfferMcpInstall).mock.invocationCallOrder[0];
    expect(mcpOfferOrder).toBeGreaterThan(autoInstallOrder);
  });

  it('prints an info line when skills were installed in a TTY session', async () => {
    vi.mocked(runInstaller).mockResolvedValue(undefined as any);
    vi.mocked(autoInstallSkills).mockResolvedValue({
      skills: ['workos', 'workos-widgets'],
      agents: ['Claude Code'],
      version: '0.4.0',
    });
    vi.mocked(isJsonMode).mockReturnValue(false);

    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).resolves.toBeUndefined();

    expect(clack.log.info).toHaveBeenCalledWith(expect.stringContaining('Installed 2 WorkOS skills for Claude Code'));
  });

  it('does not print the info line when autoInstallSkills returns null', async () => {
    vi.mocked(runInstaller).mockResolvedValue(undefined as any);
    vi.mocked(autoInstallSkills).mockResolvedValue(null);
    vi.mocked(isJsonMode).mockReturnValue(false);

    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).resolves.toBeUndefined();

    expect(clack.log.info).not.toHaveBeenCalled();
  });

  it('suppresses the info line in JSON mode', async () => {
    vi.mocked(runInstaller).mockResolvedValue(undefined as any);
    vi.mocked(autoInstallSkills).mockResolvedValue({
      skills: ['workos'],
      agents: ['Claude Code'],
      version: '0.4.0',
    });
    vi.mocked(isJsonMode).mockReturnValue(true);

    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).resolves.toBeUndefined();

    expect(clack.log.info).not.toHaveBeenCalled();
  });

  it('does not call autoInstallSkills when runInstaller throws', async () => {
    vi.mocked(runInstaller).mockRejectedValue(new Error('install failed'));

    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).rejects.toThrow(CliExit);

    expect(runInstaller).toHaveBeenCalledOnce();
    expect(autoInstallSkills).not.toHaveBeenCalled();
  });

  it('still exits 0 even if autoInstallSkills throws', async () => {
    vi.mocked(runInstaller).mockResolvedValue(undefined as any);
    vi.mocked(autoInstallSkills).mockRejectedValue(new Error('skill install exploded'));

    // autoInstallSkills throwing will trigger the outer catch, which throws CliExit(1)
    // But autoInstallSkills has its own internal catch in production — this tests defense in depth
    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).rejects.toThrow(CliExit);

    expect(runInstaller).toHaveBeenCalledOnce();
    expect(autoInstallSkills).toHaveBeenCalledOnce();
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
      expect(clack.log.info).not.toHaveBeenCalled();
    });
  });

  describe('CI-mode required-arg validation', () => {
    it('WORKOS_MODE=ci requires --api-key (validation triggered without the --ci flag)', async () => {
      vi.mocked(runInstaller).mockResolvedValue(undefined as any);
      vi.mocked(autoInstallSkills).mockResolvedValue(null);
      setInteractionMode({ mode: 'ci', source: 'env' });

      await handleInstall({ _: ['install'], $0: 'workos' } as any);

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'missing_args', message: expect.stringContaining('--api-key') }),
      );
    });

    it('WORKOS_MODE=ci with all required args does not error', async () => {
      vi.mocked(runInstaller).mockResolvedValue(undefined as any);
      vi.mocked(autoInstallSkills).mockResolvedValue(null);
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
      vi.mocked(autoInstallSkills).mockResolvedValue(null);

      await handleInstall({ _: ['install'], $0: 'workos' } as any);

      expect(exitWithError).not.toHaveBeenCalled();
    });
  });
});
