import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// debug.ts derives its log dir from homedir() at import time — mock it before
// the homedir mock below swaps in a per-test temp dir (same as env.spec.ts).
vi.mock('../utils/debug.js', () => ({
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

const mockGraphqlRequest = vi.fn();
const mockRefreshIfExpired = vi.fn();

vi.mock('./dashboard-graphql.js', async (importActual) => {
  const actual = await importActual<typeof import('./dashboard-graphql.js')>();
  return {
    ...actual,
    dashboardGraphqlRequest: (...args: unknown[]) => mockGraphqlRequest(...args),
  };
});

vi.mock('./command-auth.js', async (importActual) => {
  const actual = await importActual<typeof import('./command-auth.js')>();
  return {
    ...actual,
    refreshIfExpired: () => mockRefreshIfExpired(),
  };
});

vi.mock('../utils/clack.js', () => ({
  default: {
    log: { success: vi.fn(), error: vi.fn(), info: vi.fn(), step: vi.fn(), warn: vi.fn() },
    select: vi.fn(),
    isCancel: vi.fn(() => false),
  },
}));

let testDir: string;

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    default: { ...original, homedir: () => testDir },
    homedir: () => testDir,
  };
});

const { getConfig, saveConfig, setInsecureConfigStorage, clearConfig } = await import('./config-store.js');
const { resolveEnvironmentTarget, tryResolveProfileEnvironmentId } = await import('./environment-target.js');
const { setInteractionMode, resetInteractionModeForTests } = await import('../utils/interaction-mode.js');
const { CliExit } = await import('../utils/cli-exit.js');
const clack = (await import('../utils/clack.js')).default;

/** teamProjectsV2 response with the given environments spread over projects. */
function teamData(environments: Array<{ id: string; name?: string; clientId?: string; sandbox?: boolean }>) {
  return {
    currentTeam: {
      projectsV2: [{ environments: environments.map((env) => ({ name: env.id, sandbox: false, ...env })) }],
    },
  };
}

function seedProfile(overrides: { environmentId?: string; clientId?: string } = {}, key = 'staging') {
  saveConfig({
    activeEnvironment: key,
    environments: {
      [key]: {
        name: key,
        type: 'sandbox',
        apiKey: 'sk_test_abc',
        ...(overrides.clientId && { clientId: overrides.clientId }),
        ...(overrides.environmentId && { environmentId: overrides.environmentId }),
      },
    },
  });
}

describe('resolveEnvironmentTarget', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'env-target-test-'));
    setInsecureConfigStorage(true);
    resetInteractionModeForTests();
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    clearConfig();
    resetInteractionModeForTests();
    errorSpy.mockRestore();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  describe('flag precedence', () => {
    it('returns the flag value for reads without any fetch', async () => {
      seedProfile({ environmentId: 'env_stored' });
      const target = await resolveEnvironmentTarget('tok', { flagValue: 'env_flag', forMutation: false });
      expect(target).toEqual({ environmentId: 'env_flag', source: 'flag' });
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('validates a flag-supplied ID on mutations (valid case)', async () => {
      mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_flag' }]));
      const target = await resolveEnvironmentTarget('tok', { flagValue: 'env_flag', forMutation: true });
      expect(target).toEqual({ environmentId: 'env_flag', source: 'flag' });
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('teamProjectsV2'), { token: 'tok' });
    });

    it('exits environment_stale for a flag-supplied ID unknown to the team on mutations', async () => {
      mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_other' }]));
      await expect(
        resolveEnvironmentTarget('tok', { flagValue: 'env_typo', forMutation: true }),
      ).rejects.toMatchObject({ name: 'CliExit', context: { errorCode: 'environment_stale' } });
      // Only the validation fetch was issued — never the operation itself.
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('stored profile ID', () => {
    it('trusts the stored ID for reads without any fetch', async () => {
      seedProfile({ environmentId: 'env_stored' });
      const target = await resolveEnvironmentTarget('tok', { forMutation: false });
      expect(target).toEqual({ environmentId: 'env_stored', source: 'profile' });
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('proceeds with a stale stored ID on reads (documented trade-off: no fetch, no error)', async () => {
      seedProfile({ environmentId: 'env_deleted' });
      const target = await resolveEnvironmentTarget('tok', { forMutation: false });
      expect(target.environmentId).toBe('env_deleted');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('pre-validates the stored ID on mutations (valid case)', async () => {
      seedProfile({ environmentId: 'env_stored' });
      mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_stored' }]));
      const target = await resolveEnvironmentTarget('tok', { forMutation: true });
      expect(target).toEqual({ environmentId: 'env_stored', source: 'profile' });
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
    });

    it('exits environment_stale on mutations when the stored ID is not in the team list', async () => {
      seedProfile({ environmentId: 'env_deleted' });
      mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_live' }]));
      await expect(resolveEnvironmentTarget('tok', { forMutation: true })).rejects.toMatchObject({
        name: 'CliExit',
        context: { errorCode: 'environment_stale' },
      });
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
    });

    it('names both remedies in the stale error without mentioning internals', async () => {
      seedProfile({ environmentId: 'env_deleted' });
      mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_live' }]));
      await expect(resolveEnvironmentTarget('tok', { forMutation: true })).rejects.toThrow(CliExit);
      const err = errorSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(err).toContain('--environment-id');
      expect(err).toContain('env switch');
      expect(err).not.toMatch(/graphql/i);
    });

    it('heals a stale stored ID via the clientId join and proceeds on mutations', async () => {
      seedProfile({ environmentId: 'env_recreated_old', clientId: 'client_abc' });
      mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_recreated_new', clientId: 'client_abc' }]));
      const target = await resolveEnvironmentTarget('tok', { forMutation: true });
      expect(target).toEqual({ environmentId: 'env_recreated_new', source: 'profile' });
      expect(getConfig()?.environments.staging.environmentId).toBe('env_recreated_new');
    });
  });

  describe('clientId join', () => {
    it('joins the profile clientId against the team environments and persists the ID', async () => {
      seedProfile({ clientId: 'client_abc' });
      mockGraphqlRequest.mockResolvedValue(
        teamData([
          { id: 'env_other', clientId: 'client_other' },
          { id: 'env_joined', clientId: 'client_abc' },
        ]),
      );
      const target = await resolveEnvironmentTarget('tok', { forMutation: false });
      expect(target).toEqual({ environmentId: 'env_joined', source: 'profile' });
      // Healing write: the profile gains the joined ID.
      expect(getConfig()?.environments.staging.environmentId).toBe('env_joined');
    });

    it('never guesses for a foreign profile whose clientId joins nothing (agent mode)', async () => {
      setInteractionMode({ mode: 'agent', source: 'env' });
      seedProfile({ clientId: 'client_foreign' });
      mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_a', clientId: 'client_abc' }]));
      await expect(resolveEnvironmentTarget('tok', { forMutation: false })).rejects.toMatchObject({
        name: 'CliExit',
        context: { errorCode: 'environment_unresolved' },
      });
      expect(getConfig()?.environments.staging.environmentId).toBeUndefined();
    });
  });

  describe('picker (human mode)', () => {
    it('prompts once and persists the choice to the active profile', async () => {
      seedProfile({});
      mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_a' }, { id: 'env_b', sandbox: true }]));
      vi.mocked(clack.select).mockResolvedValue('env_b');
      const target = await resolveEnvironmentTarget('tok', { forMutation: false });
      expect(target).toEqual({ environmentId: 'env_b', source: 'picker' });
      expect(clack.select).toHaveBeenCalledTimes(1);
      expect(getConfig()?.environments.staging.environmentId).toBe('env_b');
    });

    it('exits cancelled (code 2) when the picker is dismissed', async () => {
      seedProfile({});
      mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_a' }]));
      vi.mocked(clack.select).mockResolvedValue(Symbol('cancel'));
      vi.mocked(clack.isCancel).mockReturnValue(true);
      await expect(resolveEnvironmentTarget('tok', { forMutation: false })).rejects.toMatchObject({
        name: 'CliExit',
        exitCode: 2,
      });
    });

    it('still resolves via picker with no active profile at all (nothing persisted)', async () => {
      mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_a' }]));
      vi.mocked(clack.select).mockResolvedValue('env_a');
      const target = await resolveEnvironmentTarget('tok', { forMutation: false });
      expect(target).toEqual({ environmentId: 'env_a', source: 'picker' });
      expect(getConfig()).toBeNull();
    });
  });

  describe('non-interactive unresolved', () => {
    it('exits environment_unresolved in agent mode, naming both remedies', async () => {
      setInteractionMode({ mode: 'agent', source: 'env' });
      seedProfile({});
      mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_a' }]));
      await expect(resolveEnvironmentTarget('tok', { forMutation: false })).rejects.toMatchObject({
        name: 'CliExit',
        context: { errorCode: 'environment_unresolved' },
      });
      expect(clack.select).not.toHaveBeenCalled();
      const err = errorSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(err).toContain('--environment-id');
      expect(err).toContain('env switch');
      expect(err).not.toMatch(/graphql/i);
    });
  });

  describe('fetch failures and empty teams', () => {
    it('exits environment_unresolved with transient wording when the fetch fails (read path — never proceeds headerless)', async () => {
      seedProfile({ clientId: 'client_abc' });
      mockGraphqlRequest.mockRejectedValue(new Error('boom'));
      await expect(resolveEnvironmentTarget('tok', { forMutation: false })).rejects.toMatchObject({
        name: 'CliExit',
        context: { errorCode: 'environment_unresolved' },
      });
      const err = errorSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(err).toMatch(/network or server error/i);
      expect(err).not.toMatch(/graphql/i);
    });

    it('exits environment_unresolved when the fetch fails on the mutation path', async () => {
      seedProfile({ environmentId: 'env_stored' });
      mockGraphqlRequest.mockRejectedValue(new Error('boom'));
      await expect(resolveEnvironmentTarget('tok', { forMutation: true })).rejects.toMatchObject({
        name: 'CliExit',
        context: { errorCode: 'environment_unresolved' },
      });
    });

    it('exits environment_unresolved with access guidance when the team has zero environments', async () => {
      seedProfile({ clientId: 'client_abc' });
      mockGraphqlRequest.mockResolvedValue({ currentTeam: { projectsV2: [] } });
      await expect(resolveEnvironmentTarget('tok', { forMutation: false })).rejects.toMatchObject({
        name: 'CliExit',
        context: { errorCode: 'environment_unresolved' },
      });
      const err = errorSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(err).toMatch(/access/i);
    });
  });
});

describe('tryResolveProfileEnvironmentId', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'env-target-try-test-'));
    setInsecureConfigStorage(true);
    resetInteractionModeForTests();
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
    mockRefreshIfExpired.mockResolvedValue({ accessToken: 'tok_refreshed', refreshed: false });
  });

  afterEach(() => {
    clearConfig();
    resetInteractionModeForTests();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('joins via clientId, persists, and reports success', async () => {
    seedProfile({ clientId: 'client_abc' });
    mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_joined', clientId: 'client_abc' }]));
    await expect(tryResolveProfileEnvironmentId('staging')).resolves.toBe(true);
    expect(getConfig()?.environments.staging.environmentId).toBe('env_joined');
  });

  it('uses the provided token instead of refreshing a stored session', async () => {
    seedProfile({ clientId: 'client_abc' });
    mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_joined', clientId: 'client_abc' }]));
    await expect(tryResolveProfileEnvironmentId('staging', { token: 'tok_given' })).resolves.toBe(true);
    expect(mockRefreshIfExpired).not.toHaveBeenCalled();
    expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.any(String), { token: 'tok_given' });
  });

  it('is a no-op success when the profile already has an environmentId', async () => {
    seedProfile({ environmentId: 'env_existing' });
    await expect(tryResolveProfileEnvironmentId('staging')).resolves.toBe(true);
    expect(mockGraphqlRequest).not.toHaveBeenCalled();
  });

  it('reports false without a usable session (logged out — defers to first use)', async () => {
    seedProfile({ clientId: 'client_abc' });
    mockRefreshIfExpired.mockResolvedValue(null);
    await expect(tryResolveProfileEnvironmentId('staging')).resolves.toBe(false);
    expect(mockGraphqlRequest).not.toHaveBeenCalled();
    expect(getConfig()?.environments.staging.environmentId).toBeUndefined();
  });

  it('swallows fetch failures (best-effort, never blocks the caller)', async () => {
    seedProfile({ clientId: 'client_abc' });
    mockGraphqlRequest.mockRejectedValue(new Error('boom'));
    await expect(tryResolveProfileEnvironmentId('staging')).resolves.toBe(false);
  });

  it('offers the picker when allowed in human mode and the join misses', async () => {
    seedProfile({});
    mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_a' }, { id: 'env_b' }]));
    vi.mocked(clack.select).mockResolvedValue('env_a');
    await expect(tryResolveProfileEnvironmentId('staging', { allowPicker: true })).resolves.toBe(true);
    expect(getConfig()?.environments.staging.environmentId).toBe('env_a');
  });

  it('treats picker cancel as a skip, leaving the profile untouched', async () => {
    seedProfile({});
    mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_a' }]));
    vi.mocked(clack.select).mockResolvedValue(Symbol('cancel'));
    vi.mocked(clack.isCancel).mockReturnValue(true);
    await expect(tryResolveProfileEnvironmentId('staging', { allowPicker: true })).resolves.toBe(false);
    expect(getConfig()?.environments.staging.environmentId).toBeUndefined();
  });

  it('never prompts when the picker is not allowed (env add non-interactive path)', async () => {
    seedProfile({});
    mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_a' }]));
    await expect(tryResolveProfileEnvironmentId('staging')).resolves.toBe(false);
    expect(clack.select).not.toHaveBeenCalled();
  });

  it('never prompts in agent mode even when the picker is allowed', async () => {
    setInteractionMode({ mode: 'agent', source: 'env' });
    seedProfile({});
    mockGraphqlRequest.mockResolvedValue(teamData([{ id: 'env_a' }]));
    await expect(tryResolveProfileEnvironmentId('staging', { allowPicker: true })).resolves.toBe(false);
    expect(clack.select).not.toHaveBeenCalled();
  });

  it('reports false for a missing profile key', async () => {
    await expect(tryResolveProfileEnvironmentId('missing')).resolves.toBe(false);
    expect(mockGraphqlRequest).not.toHaveBeenCalled();
  });
});
