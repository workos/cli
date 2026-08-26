import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock config-store
const mockGetActiveEnvironment = vi.fn();
const mockIsUnclaimedEnvironment = vi.fn();
const mockGetConfig = vi.fn();
const mockSetActiveEnvironment = vi.fn();
const mockSaveConfig = vi.fn();
vi.mock('./config-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config-store.js')>();
  return {
    ...actual,
    getActiveEnvironment: (...args: unknown[]) => mockGetActiveEnvironment(...args),
    isUnclaimedEnvironment: (...args: unknown[]) => mockIsUnclaimedEnvironment(...args),
    getConfig: () => mockGetConfig(),
    setActiveEnvironment: (...args: unknown[]) => mockSetActiveEnvironment(...args),
    saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  };
});

// Mock credentials
const mockGetAccessToken = vi.fn();
const mockGetStagingCredentials = vi.fn();
const mockSaveStagingCredentials = vi.fn();
vi.mock('./credentials.js', () => ({
  getAccessToken: () => mockGetAccessToken(),
  getStagingCredentials: () => mockGetStagingCredentials(),
  saveStagingCredentials: (...args: unknown[]) => mockSaveStagingCredentials(...args),
}));

// Mock the staging API
const mockFetchStagingCredentials = vi.fn();
vi.mock('./staging-api.js', () => ({
  fetchStagingCredentials: (...args: unknown[]) => mockFetchStagingCredentials(...args),
}));

// Mock unclaimed-env-provision
const mockTryProvisionUnclaimedEnv = vi.fn();
vi.mock('./unclaimed-env-provision.js', () => ({
  tryProvisionUnclaimedEnv: (...args: unknown[]) => mockTryProvisionUnclaimedEnv(...args),
}));

// Mock the UI facade — the no-clobber branch now explains itself out loud.
const CANCEL = Symbol('cancel');
const mockSelect = vi.fn();
const mockUi = {
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn(), success: vi.fn(), hint: vi.fn() },
  note: vi.fn(),
  select: (...args: unknown[]) => mockSelect(...args),
  isCancel: (value: unknown) => value === CANCEL,
};
vi.mock('../utils/ui.js', () => ({ default: mockUi }));

const { resolveInstallCredentials, resolveStagingCredentials } = await import('./resolve-install-credentials.js');
const { setOutputMode } = await import('../utils/output.js');

describe('resolveInstallCredentials', () => {
  const mockAuthenticate = vi.fn();
  const originalEnv = process.env.WORKOS_API_KEY;
  // The default install dir is process.cwd(), and credential resolution now
  // reads the project's env file. Point cwd at an empty dir so these specs
  // don't depend on whatever .env.local happens to sit in the repo root.
  let emptyCwd: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue(null);
    delete process.env.WORKOS_API_KEY;
    emptyCwd = mkdtempSync(join(tmpdir(), 'resolve-install-credentials-cwd-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(emptyCwd);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    setOutputMode('human');
    rmSync(emptyCwd, { recursive: true, force: true });
    if (originalEnv !== undefined) {
      process.env.WORKOS_API_KEY = originalEnv;
    } else {
      delete process.env.WORKOS_API_KEY;
    }
  });

  it('returns immediately when WORKOS_API_KEY env var is set', async () => {
    process.env.WORKOS_API_KEY = 'sk_test_env';

    await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

    expect(mockGetActiveEnvironment).not.toHaveBeenCalled();
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('returns immediately when apiKey argument is provided', async () => {
    await resolveInstallCredentials('sk_test_flag', undefined, undefined, mockAuthenticate);

    expect(mockGetActiveEnvironment).not.toHaveBeenCalled();
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('returns without auth when active env is unclaimed', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
      clientId: 'client_01ABC',
      claimToken: 'ct_token',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);

    await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(mockTryProvisionUnclaimedEnv).not.toHaveBeenCalled();
  });

  it('returns without auth when active env has API key and a valid OAuth token', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      type: 'sandbox',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(false);
    mockGetAccessToken.mockReturnValue('access_token');

    await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('authenticates when active env has API key but no valid gateway auth', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      type: 'sandbox',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(false);
    mockGetAccessToken.mockReturnValue(null);

    await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

    expect(mockAuthenticate).toHaveBeenCalled();
  });

  it('skips auth when skipAuth is true and env has API key but no gateway auth', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      type: 'sandbox',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(false);
    mockGetAccessToken.mockReturnValue(null);

    await resolveInstallCredentials(undefined, undefined, true, mockAuthenticate);

    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('tries unclaimed provisioning when no active environment', async () => {
    mockGetActiveEnvironment.mockReturnValue(null);
    mockTryProvisionUnclaimedEnv.mockResolvedValue(true);

    await resolveInstallCredentials(undefined, '/test/dir', undefined, mockAuthenticate);

    expect(mockTryProvisionUnclaimedEnv).toHaveBeenCalledWith({ installDir: '/test/dir' });
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('falls back to auth when provisioning fails', async () => {
    mockGetActiveEnvironment.mockReturnValue(null);
    mockTryProvisionUnclaimedEnv.mockResolvedValue(false);

    await resolveInstallCredentials(undefined, '/test/dir', undefined, mockAuthenticate);

    expect(mockTryProvisionUnclaimedEnv).toHaveBeenCalled();
    expect(mockAuthenticate).toHaveBeenCalled();
  });

  it('skips auth fallback when provisioning fails and skipAuth is true', async () => {
    mockGetActiveEnvironment.mockReturnValue(null);
    mockTryProvisionUnclaimedEnv.mockResolvedValue(false);

    await resolveInstallCredentials(undefined, undefined, true, mockAuthenticate);

    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('uses process.cwd() when no installDir provided', async () => {
    mockGetActiveEnvironment.mockReturnValue(null);
    mockTryProvisionUnclaimedEnv.mockResolvedValue(true);

    await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

    expect(mockTryProvisionUnclaimedEnv).toHaveBeenCalledWith({ installDir: process.cwd() });
  });

  // Provisioning writes credentials into the project's env file. If a key is
  // already there, provisioning would clobber it — the reported data-loss bug.
  describe('project env file already has credentials', () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), 'resolve-install-credentials-test-'));
      mockGetActiveEnvironment.mockReturnValue(null);
      mockTryProvisionUnclaimedEnv.mockResolvedValue(true);
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it('skips provisioning and falls back to login when .env.local has WORKOS_API_KEY (JS project)', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env.local'), 'WORKOS_API_KEY=sk_a\nWORKOS_CLIENT_ID=client_a\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).not.toHaveBeenCalled();
      expect(mockAuthenticate).toHaveBeenCalled();
    });

    it('skips provisioning when .env has WORKOS_API_KEY and there is no package.json (non-JS project)', async () => {
      writeFileSync(join(projectDir, '.env'), 'WORKOS_API_KEY=sk_a\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).not.toHaveBeenCalled();
      expect(mockAuthenticate).toHaveBeenCalled();
    });

    it('does not authenticate when skipAuth is set and the project env already has a key', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env.local'), 'WORKOS_API_KEY=sk_a\n');

      await resolveInstallCredentials(undefined, projectDir, true, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).not.toHaveBeenCalled();
      expect(mockAuthenticate).not.toHaveBeenCalled();
    });

    it('provisions when .env.local exists but carries no WorkOS keys', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env.local'), 'DATABASE_URL=postgres://localhost/dev\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).toHaveBeenCalledWith({ installDir: projectDir });
      expect(mockAuthenticate).not.toHaveBeenCalled();
    });

    it('provisions when the project has no env file at all', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).toHaveBeenCalledWith({ installDir: projectDir });
    });

    // The read side must cover every file the CLI itself treats as a credential
    // source (credential-discovery.ts), not just the write target. `.env.local`
    // outranks `.env` in Next.js/Vite/Remix/SvelteKit, so provisioning here would
    // point the app at an empty throwaway env while the real key sits in `.env`.
    it('refuses to provision when a JS project keeps its key in .env and has no .env.local', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env'), 'WORKOS_API_KEY=sk_real\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).not.toHaveBeenCalled();
      expect(mockAuthenticate).toHaveBeenCalled();
    });

    it('refuses to provision when the key is in .env.development.local', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env.development.local'), 'WORKOS_API_KEY=sk_real\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).not.toHaveBeenCalled();
      expect(mockAuthenticate).toHaveBeenCalled();
    });

    it('refuses to provision when the key is in .env.development', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env.development'), 'WORKOS_API_KEY=sk_real\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).not.toHaveBeenCalled();
      expect(mockAuthenticate).toHaveBeenCalled();
    });

    // `export`-prefixed and indented lines are common in env files people `source`.
    it('refuses to provision for `export WORKOS_API_KEY=` syntax with leading whitespace', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env.local'), '  export WORKOS_API_KEY="sk_real"\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).not.toHaveBeenCalled();
      expect(mockAuthenticate).toHaveBeenCalled();
    });

    it('still provisions when no env file anywhere carries a WorkOS key', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env.local'), 'DATABASE_URL=postgres://localhost/dev\n');
      writeFileSync(join(projectDir, '.env.development'), '# WORKOS_API_KEY=sk_commented_out\n');
      writeFileSync(join(projectDir, '.env'), 'NEXT_PUBLIC_URL=http://localhost:3000\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).toHaveBeenCalledWith({ installDir: projectDir });
      expect(mockAuthenticate).not.toHaveBeenCalled();
    });

    // Exit 4 from the login that follows is byte-identical to a provisioning
    // network failure, so the refusal has to say why out loud.
    it('tells the user the existing key was found and kept, naming the file it is in', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env'), 'WORKOS_API_KEY=sk_real\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      const printed = mockUi.log.info.mock.calls.map((call) => String(call[0])).join('\n');
      // The file the key actually lives in, not the write target (.env.local here).
      expect(printed).toContain(`${join(projectDir, '.env')} already has WORKOS_API_KEY`);
      expect(printed).toContain('Signing you in');
    });

    it('stays silent in JSON mode so the machine-readable stream is not corrupted', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env.local'), 'WORKOS_API_KEY=sk_real\n');
      setOutputMode('json');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockUi.log.info).not.toHaveBeenCalled();
      expect(mockAuthenticate).toHaveBeenCalled();
    });
  });

  describe('environment picker', () => {
    const twoProfiles = {
      activeEnvironment: 'staging-3',
      environments: {
        staging: {
          name: 'staging',
          type: 'sandbox',
          apiKey: 'sk_test_a',
          environmentName: 'test12',
          projectName: "Nick's Team's Project",
        },
        'staging-3': {
          name: 'staging-3',
          type: 'sandbox',
          apiKey: 'sk_test_b',
          environmentName: 'Staging',
          projectName: 'cli-branding-smoke',
        },
      },
    };

    beforeEach(() => {
      mockGetActiveEnvironment.mockReturnValue(twoProfiles.environments['staging-3']);
      mockIsUnclaimedEnvironment.mockReturnValue(false);
      mockGetAccessToken.mockReturnValue('token_x');
    });

    it('prompts with project-prefixed labels and persists a different choice', async () => {
      mockGetConfig.mockReturnValue(twoProfiles);
      mockSelect.mockResolvedValue('staging');

      await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

      const call = mockSelect.mock.calls[0][0] as {
        options: Array<{ value: string; label: string }>;
        initialValue: string;
      };
      expect(call.initialValue).toBe('staging-3');
      // Environment-first labels, column-aligned, with the profile key and
      // type dim in the metadata and the active row marked.
      const labels = call.options.map((o) => o.label);
      expect(labels[0]).toMatch(/^Nick's Team's Project > test12\s+staging · Sandbox$/);
      expect(labels[1]).toMatch(/^cli-branding-smoke > Staging\s+staging-3 · Sandbox ● active$/);
      // Framed intro line gives the prompt breathing room.
      expect(mockUi.note).toHaveBeenCalledWith(expect.stringContaining('pick the one this app should call home'));
      expect(mockSetActiveEnvironment).toHaveBeenCalledWith('staging');
    });

    it('keeps the active profile without a config write when it is re-chosen', async () => {
      mockGetConfig.mockReturnValue(twoProfiles);
      mockSelect.mockResolvedValue('staging-3');

      await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

      expect(mockSetActiveEnvironment).not.toHaveBeenCalled();
    });

    it('never prompts with a single keyed profile', async () => {
      mockGetConfig.mockReturnValue({
        activeEnvironment: 'staging-3',
        environments: { 'staging-3': twoProfiles.environments['staging-3'] },
      });

      await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

      expect(mockSelect).not.toHaveBeenCalled();
    });

    it('never prompts in non-interactive modes', async () => {
      const { setInteractionMode, resetInteractionModeForTests } = await import('../utils/interaction-mode.js');
      setInteractionMode({ mode: 'agent', source: 'env' });
      try {
        mockGetConfig.mockReturnValue(twoProfiles);
        await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);
        expect(mockSelect).not.toHaveBeenCalled();
      } finally {
        resetInteractionModeForTests();
      }
    });

    it('never prompts in JSON mode, even on a TTY', async () => {
      mockGetConfig.mockReturnValue(twoProfiles);
      setOutputMode('json');

      await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

      expect(mockSelect).not.toHaveBeenCalled();
    });

    it('never prompts when the project already carries WORKOS_API_KEY', async () => {
      // The no-clobber contract: a project key is kept, so offering a profile
      // pick here would set up an overwrite with a different environment's key.
      writeFileSync(join(emptyCwd, '.env'), 'WORKOS_API_KEY=sk_project\n');
      mockGetConfig.mockReturnValue(twoProfiles);

      await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockSetActiveEnvironment).not.toHaveBeenCalled();
    });

    it('cancel cancels the install (exit 2)', async () => {
      mockGetConfig.mockReturnValue(twoProfiles);
      mockSelect.mockResolvedValue(CANCEL);

      await expect(resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate)).rejects.toMatchObject({
        exitCode: 2,
      });
      expect(mockSetActiveEnvironment).not.toHaveBeenCalled();
    });
  });

  // The machine-side half of the no-clobber contract: a key-only project scans
  // as "no valid credentials" (client ID missing/invalid) and lands in the
  // staging-credential step, which must not hand configureEnvironment a
  // different environment's key to upsert over the project's own.
  describe('resolveStagingCredentials', () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), 'resolve-staging-credentials-test-'));
      mockGetActiveEnvironment.mockReturnValue({
        name: 'staging',
        type: 'sandbox',
        apiKey: 'sk_test_active_key',
        clientId: 'client_01ACTIVE',
      });
      mockGetStagingCredentials.mockReturnValue(null);
      mockGetAccessToken.mockReturnValue('token_x');
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it('returns the active profile pair when the project carries no key', async () => {
      const result = await resolveStagingCredentials(projectDir, true);

      expect(result).toEqual({ clientId: 'client_01ACTIVE', apiKey: 'sk_test_active_key' });
    });

    it('refuses a key-only project after a consented scan, routing to the manual prompt', async () => {
      // The scan found no valid client ID (or the pair would have gone
      // straight to configuring), and no API maps a secret key back to its
      // environment — so no fallback pair is safe to write. The machine
      // routes staging failures to the manual credential prompt.
      writeFileSync(join(projectDir, '.env'), 'WORKOS_API_KEY=sk_test_project_key\n');

      await expect(resolveStagingCredentials(projectDir, true)).rejects.toThrow(/no valid WORKOS_CLIENT_ID/);
      expect(mockFetchStagingCredentials).not.toHaveBeenCalled();
    });

    it('returns the active profile pair for a key-only project when the scan was declined', async () => {
      // Declining the scan opts the project out of its env files being used —
      // the CLI-side fallback pair applies, overwrite and all.
      writeFileSync(join(projectDir, '.env'), 'WORKOS_API_KEY=sk_test_project_key\n');

      const result = await resolveStagingCredentials(projectDir, false);

      expect(result).toEqual({ clientId: 'client_01ACTIVE', apiKey: 'sk_test_active_key' });
    });

    it('treats an invalid project key as absent, matching credential discovery', async () => {
      writeFileSync(join(projectDir, '.env'), 'WORKOS_API_KEY=not-a-real-key\n');

      const result = await resolveStagingCredentials(projectDir, true);

      expect(result).toEqual({ clientId: 'client_01ACTIVE', apiKey: 'sk_test_active_key' });
    });
  });
});
