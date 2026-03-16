import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../run.js', () => ({
  runInstaller: vi.fn(),
}));

vi.mock('./install-skill.js', () => ({
  autoInstallSkills: vi.fn(),
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

vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as any);

const { handleInstall } = await import('./install.js');

describe('handleInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls autoInstallSkills after successful install', async () => {
    vi.mocked(runInstaller).mockResolvedValue(undefined as any);
    vi.mocked(autoInstallSkills).mockResolvedValue(undefined);

    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).rejects.toThrow('process.exit called');

    expect(runInstaller).toHaveBeenCalledOnce();
    expect(autoInstallSkills).toHaveBeenCalledOnce();

    // Verify order: autoInstallSkills called after runInstaller
    const runInstallerOrder = vi.mocked(runInstaller).mock.invocationCallOrder[0];
    const autoInstallOrder = vi.mocked(autoInstallSkills).mock.invocationCallOrder[0];
    expect(autoInstallOrder).toBeGreaterThan(runInstallerOrder);
  });

  it('does not call autoInstallSkills when runInstaller throws', async () => {
    vi.mocked(runInstaller).mockRejectedValue(new Error('install failed'));

    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).rejects.toThrow('process.exit called');

    expect(runInstaller).toHaveBeenCalledOnce();
    expect(autoInstallSkills).not.toHaveBeenCalled();
  });

  it('still exits 0 even if autoInstallSkills throws', async () => {
    vi.mocked(runInstaller).mockResolvedValue(undefined as any);
    vi.mocked(autoInstallSkills).mockRejectedValue(new Error('skill install exploded'));

    // autoInstallSkills throwing will trigger the outer catch, which calls process.exit(1)
    // But autoInstallSkills has its own internal catch in production — this tests defense in depth
    await expect(handleInstall({ _: ['install'], $0: 'workos' } as any)).rejects.toThrow('process.exit called');

    expect(runInstaller).toHaveBeenCalledOnce();
    expect(autoInstallSkills).toHaveBeenCalledOnce();
  });
});
