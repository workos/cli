import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockRequireCommandToken = vi.fn();
const mockGraphqlRequest = vi.fn();

vi.mock('../lib/command-auth.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/command-auth.js')>();
  return {
    ...actual,
    requireCommandToken: () => mockRequireCommandToken(),
  };
});

vi.mock('../lib/dashboard-graphql.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/dashboard-graphql.js')>();
  return {
    ...actual,
    dashboardGraphqlRequest: (...args: unknown[]) => mockGraphqlRequest(...args),
  };
});

// The resolver's own matrix lives in environment-target.spec.ts; commands only
// need to prove they thread its output into the request (variable + header).
const mockResolveEnvironmentTarget = vi.fn();
const mockPromptForEnvironment = vi.fn();
vi.mock('../lib/environment-target.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/environment-target.js')>();
  return {
    ...actual,
    resolveEnvironmentTarget: (...args: unknown[]) => mockResolveEnvironmentTarget(...args),
    promptForEnvironment: (...args: unknown[]) => mockPromptForEnvironment(...args),
  };
});

// `use` writes the choice to the local profile; keep the store in-memory.
const mockGetConfig = vi.fn();
const mockSetProfileEnvironmentId = vi.fn();
vi.mock('../lib/config-store.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/config-store.js')>();
  return {
    ...actual,
    getConfig: () => mockGetConfig(),
    setProfileEnvironmentId: (...args: unknown[]) => mockSetProfileEnvironmentId(...args),
  };
});

const { setOutputMode } = await import('../utils/output.js');
const { DashboardGraphqlError } = await import('../lib/dashboard-graphql.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { runEnvironmentCreate, runEnvironmentRename, runEnvironmentList, runEnvironmentUse } =
  await import('./environment.js');

const TEAM_DATA = {
  currentTeam: {
    projectsV2: [
      {
        name: 'P1',
        environments: [
          { id: 'env_targeted', name: 'Staging', sandbox: true },
          { id: 'env_2', name: 'Prod', sandbox: false },
        ],
      },
    ],
  },
};

const ACTIVE_CONFIG = {
  activeEnvironment: 'staging',
  environments: {
    staging: { name: 'staging', type: 'sandbox', apiKey: 'sk_test_x', environmentId: 'env_targeted' },
  },
};

describe('environment command', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCommandToken.mockResolvedValue('tok_123');
    mockResolveEnvironmentTarget.mockImplementation(async (_token: string, opts: { flagValue?: string }) => ({
      environmentId: opts.flagValue ?? 'env_profile',
      source: opts.flagValue ? 'flag' : 'profile',
    }));
    mockGetConfig.mockReturnValue(ACTIVE_CONFIG);
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setOutputMode('human');
  });

  describe('create', () => {
    it('maps name + sandbox to the createEnvironment input and sends the resolved environment header', async () => {
      mockGraphqlRequest.mockResolvedValue({
        createEnvironment: { environment: { id: 'env_1', name: 'Staging', sandbox: true } },
      });
      await runEnvironmentCreate({ name: 'Staging', sandbox: true });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('createEnvironment'), {
        token: 'tok_123',
        variables: { input: { name: 'Staging', isSandbox: true } },
        environmentId: 'env_profile',
      });
      // Mutation: the resolver must have been asked to pre-validate.
      expect(mockResolveEnvironmentTarget).toHaveBeenCalledWith('tok_123', {
        flagValue: undefined,
        forMutation: true,
      });
      expect(consoleOutput.join('\n')).toContain('Staging');
    });

    it('never issues the mutation when the target is stale/unresolved', async () => {
      mockResolveEnvironmentTarget.mockRejectedValue(
        new CliExit(1, { reason: 'validation_error', errorCode: 'environment_stale' }),
      );
      await expect(runEnvironmentCreate({ name: 'Staging', sandbox: true })).rejects.toMatchObject({
        name: 'CliExit',
        context: { errorCode: 'environment_stale' },
      });
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('exits auth-required (code 4) when not logged in', async () => {
      // requireCommandToken never returns without a usable session: it throws
      // a structured exit-4 (see command-auth.spec.ts for the full matrix).
      mockRequireCommandToken.mockImplementation(() => {
        throw new CliExit(4, { reason: 'auth_required', errorCode: 'auth_required' });
      });
      await expect(runEnvironmentCreate({ name: 'Staging', sandbox: false })).rejects.toMatchObject({
        name: 'CliExit',
        exitCode: 4,
      });
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('surfaces the gated-capability case on a 403 without naming GraphQL', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      mockGraphqlRequest.mockRejectedValue(
        new DashboardGraphqlError('The dashboard GraphQL API rejected this session (HTTP 403).', 'forbidden', 403),
      );
      await expect(runEnvironmentCreate({ name: 'Staging', sandbox: false })).rejects.toBeInstanceOf(CliExit);
      const err = consoleErrors.join('\n');
      // The cleaned message must explain the gated capability but never echo the
      // client's "GraphQL" phrasing.
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });

    it('outputs JSON in json mode', async () => {
      setOutputMode('json');
      mockGraphqlRequest.mockResolvedValue({
        createEnvironment: { environment: { id: 'env_1', name: 'Prod', sandbox: false } },
      });
      await runEnvironmentCreate({ name: 'Prod', sandbox: false });
      const out = JSON.parse(consoleOutput[0]);
      expect(out.environment.id).toBe('env_1');
    });
  });

  describe('rename', () => {
    it('maps environmentId + name to the renameEnvironment input and sends the header', async () => {
      mockGraphqlRequest.mockResolvedValue({ renameEnvironment: { environment: { id: 'env_1', name: 'Renamed' } } });
      await runEnvironmentRename({ environmentId: 'env_1', name: 'Renamed' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('renameEnvironment'), {
        token: 'tok_123',
        variables: { input: { environmentId: 'env_1', name: 'Renamed' } },
        environmentId: 'env_1',
      });
      // The explicit positional target is pre-validated like a flag value.
      expect(mockResolveEnvironmentTarget).toHaveBeenCalledWith('tok_123', {
        flagValue: 'env_1',
        forMutation: true,
      });
      expect(consoleOutput.join('\n')).toContain('Renamed');
    });

    it('outputs JSON in json mode', async () => {
      setOutputMode('json');
      mockGraphqlRequest.mockResolvedValue({ renameEnvironment: { environment: { id: 'env_1', name: 'Renamed' } } });
      await runEnvironmentRename({ environmentId: 'env_1', name: 'Renamed' });
      const out = JSON.parse(consoleOutput[0]);
      expect(out.environment.name).toBe('Renamed');
    });
  });

  describe('list', () => {
    it('flattens projects into environments and marks the one the active profile targets', async () => {
      mockGraphqlRequest.mockResolvedValue(TEAM_DATA);
      await runEnvironmentList();
      const out = consoleOutput.join('\n');
      expect(out).toContain('Staging');
      expect(out).toContain('env_targeted');
      expect(out).toContain('P1');
      expect(out).toMatch(/▸\s+Staging/);
    });

    it('heals stored profiles from the fetched list', async () => {
      mockGetConfig.mockReturnValue({
        activeEnvironment: 'staging',
        environments: { staging: { name: 'staging', type: 'sandbox', apiKey: 'k', clientId: 'client_2' } },
      });
      mockGraphqlRequest.mockResolvedValue({
        currentTeam: {
          projectsV2: [
            { name: 'P1', environments: [{ id: 'env_2', name: 'Prod', sandbox: false, clientId: 'client_2' }] },
          ],
        },
      });
      await runEnvironmentList();
      expect(mockSetProfileEnvironmentId).toHaveBeenCalledWith('staging', 'env_2', 'Prod', 'P1');
    });

    it('outputs JSON in json mode', async () => {
      setOutputMode('json');
      mockGraphqlRequest.mockResolvedValue(TEAM_DATA);
      await runEnvironmentList();
      const out = JSON.parse(consoleOutput[0]);
      expect(out.environments).toHaveLength(2);
      expect(out.environments[0]).toEqual({
        id: 'env_targeted',
        name: 'Staging',
        sandbox: true,
        project: 'P1',
        targeted: true,
      });
      expect(out.environments[1].targeted).toBe(false);
    });
  });

  describe('use', () => {
    it('persists an explicit environment ID onto the active profile', async () => {
      mockGraphqlRequest.mockResolvedValue(TEAM_DATA);
      await runEnvironmentUse('env_2');
      expect(mockSetProfileEnvironmentId).toHaveBeenCalledWith('staging', 'env_2', 'Prod', 'P1');
      expect(consoleOutput.join('\n')).toContain('Prod');
    });

    it('rejects an unknown environment ID without writing', async () => {
      mockGraphqlRequest.mockResolvedValue(TEAM_DATA);
      await expect(runEnvironmentUse('env_nope')).rejects.toMatchObject({
        name: 'CliExit',
        context: { errorCode: 'not_found' },
      });
      expect(mockSetProfileEnvironmentId).not.toHaveBeenCalled();
    });

    it('persists the picker choice when no ID is given', async () => {
      mockGraphqlRequest.mockResolvedValue(TEAM_DATA);
      mockPromptForEnvironment.mockResolvedValue('env_2');
      await runEnvironmentUse();
      expect(mockSetProfileEnvironmentId).toHaveBeenCalledWith('staging', 'env_2', 'Prod', 'P1');
    });

    it('exits when there is no active profile', async () => {
      mockGetConfig.mockReturnValue({ environments: {} });
      await expect(runEnvironmentUse('env_2')).rejects.toMatchObject({
        name: 'CliExit',
        context: { errorCode: 'no_active_environment' },
      });
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });
  });
});
