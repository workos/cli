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

// Resolver matrix is covered in environment-target.spec.ts; these tests only
// assert the commands thread its output (flag override or profile default)
// into the request as both operation variable and environment header.
const mockResolveEnvironmentTarget = vi.fn();
vi.mock('../lib/environment-target.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/environment-target.js')>();
  return {
    ...actual,
    resolveEnvironmentTarget: (...args: unknown[]) => mockResolveEnvironmentTarget(...args),
  };
});

const { setOutputMode } = await import('../utils/output.js');
const { DashboardGraphqlError } = await import('../lib/dashboard-graphql.js');
const { CliExit } = await import('../utils/cli-exit.js');
const {
  runAuthkitRedirectUrisList,
  runAuthkitRedirectUrisSet,
  runAuthkitCorsGet,
  runAuthkitCorsSet,
  runAuthkitLogoutUrisList,
  runAuthkitLogoutUrisSet,
  runAuthkitBrandingGet,
} = await import('./authkit.js');

describe('authkit command', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCommandToken.mockResolvedValue('tok_123');
    mockResolveEnvironmentTarget.mockImplementation(async (_token: string, opts: { flagValue?: string }) => ({
      environmentId: opts.flagValue?.trim() || 'env_profile',
      source: opts.flagValue?.trim() ? 'flag' : 'profile',
    }));
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

  describe('redirect-uris list', () => {
    it('passes environmentId (variable + header) and renders the URIs', async () => {
      mockGraphqlRequest.mockResolvedValue({
        redirectUris: { data: [{ id: 'ru_1', uri: 'https://app.com/callback', isDefault: true }] },
      });
      await runAuthkitRedirectUrisList({ environmentId: 'env_1' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('redirectUris'), {
        token: 'tok_123',
        variables: { environmentId: 'env_1' },
        environmentId: 'env_1',
      });
      expect(consoleOutput.join('\n')).toContain('https://app.com/callback');
    });

    it('defaults environmentId from the active profile when the flag is omitted', async () => {
      mockGraphqlRequest.mockResolvedValue({ redirectUris: { data: [] } });
      await runAuthkitRedirectUrisList({});
      expect(mockResolveEnvironmentTarget).toHaveBeenCalledWith('tok_123', {
        flagValue: undefined,
        forMutation: false,
      });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('redirectUris'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile' },
        environmentId: 'env_profile',
      });
    });

    it('never calls the API when the environment target cannot be resolved', async () => {
      mockResolveEnvironmentTarget.mockRejectedValue(
        new CliExit(1, { reason: 'validation_error', errorCode: 'environment_unresolved' }),
      );
      await expect(runAuthkitRedirectUrisList({})).rejects.toBeInstanceOf(CliExit);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('outputs JSON in json mode', async () => {
      setOutputMode('json');
      mockGraphqlRequest.mockResolvedValue({
        redirectUris: { data: [{ id: 'ru_1', uri: 'https://a.com', isDefault: false }] },
      });
      await runAuthkitRedirectUrisList({ environmentId: 'env_1' });
      const out = JSON.parse(consoleOutput[0]);
      expect(out.redirectUris[0].uri).toBe('https://a.com');
    });
  });

  describe('redirect-uris set', () => {
    const ok = {
      setRedirectUris: {
        __typename: 'RedirectUrisSet',
        redirectUris: [{ id: 'ru_1', uri: 'https://a.com/cb', isDefault: false }],
      },
    };

    it('maps --uri to the env-level setRedirectUris input (not the application-level userland op)', async () => {
      mockGraphqlRequest.mockResolvedValue(ok);
      await runAuthkitRedirectUrisSet({ environmentId: 'env_1', uris: ['https://a.com/cb'] });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('setRedirectUris'), {
        token: 'tok_123',
        variables: { input: { environmentId: 'env_1', redirectUris: [{ uri: 'https://a.com/cb' }], dryRun: false } },
        environmentId: 'env_1',
      });
      // Set operations are mutations: the resolver must pre-validate the target.
      expect(mockResolveEnvironmentTarget).toHaveBeenCalledWith('tok_123', {
        flagValue: 'env_1',
        forMutation: true,
      });
      // Selection-correctness: the leak test cannot catch a wrong op here (the
      // application-level op only leaks `userland` in its input *type* name), so
      // assert directly that we wired the env-level op.
      const sentDocument = mockGraphqlRequest.mock.calls[0][0] as string;
      expect(sentDocument).not.toContain('AuthkitApplication');
      expect(sentDocument).not.toMatch(/userland/i);
    });

    it('marks the chosen --default URI as isDefault', async () => {
      mockGraphqlRequest.mockResolvedValue(ok);
      await runAuthkitRedirectUrisSet({
        environmentId: 'env_1',
        uris: ['https://a.com/cb', 'https://b.com/cb'],
        default: 'https://b.com/cb',
      });
      const variables = mockGraphqlRequest.mock.calls[0][1] as { variables: { input: { redirectUris: unknown[] } } };
      expect(variables.variables.input.redirectUris).toEqual([
        { uri: 'https://a.com/cb', isDefault: false },
        { uri: 'https://b.com/cb', isDefault: true },
      ]);
    });

    it('rejects a --default that matches none of the --uri values', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(
        runAuthkitRedirectUrisSet({ environmentId: 'env_1', uris: ['https://a.com/cb'], default: 'https://typo.com' }),
      ).rejects.toMatchObject({ name: 'CliExit', context: { errorCode: 'invalid_argument' } });
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('--dry-run sends dryRun:true and reports validation, not a save', async () => {
      mockGraphqlRequest.mockResolvedValue(ok);
      await runAuthkitRedirectUrisSet({ environmentId: 'env_1', uris: ['https://a.com/cb'], dryRun: true });
      const variables = mockGraphqlRequest.mock.calls[0][1] as { variables: { input: { dryRun: boolean } } };
      expect(variables.variables.input.dryRun).toBe(true);
      const out = consoleOutput.join('\n');
      expect(out).toMatch(/validated/i);
      expect(out).toMatch(/dry run/i);
    });

    it('rejects when no --uri is given', async () => {
      await expect(runAuthkitRedirectUrisSet({ environmentId: 'env_1', uris: [] })).rejects.toBeInstanceOf(CliExit);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('surfaces a validation union error cleanly', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      mockGraphqlRequest.mockResolvedValue({
        setRedirectUris: { __typename: 'InvalidRedirectUriError', message: 'Not a valid URI', uri: 'http://bad' },
      });
      await expect(runAuthkitRedirectUrisSet({ environmentId: 'env_1', uris: ['http://bad'] })).rejects.toMatchObject({
        name: 'CliExit',
        context: { errorCode: 'invalid_redirect_uri' },
      });
      expect(consoleErrors.join('\n')).toContain('Not a valid URI');
    });

    it('surfaces the gated-capability case on a 403 without naming GraphQL', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      mockGraphqlRequest.mockRejectedValue(
        new DashboardGraphqlError('The dashboard GraphQL API rejected this session (HTTP 403).', 'forbidden', 403),
      );
      await expect(
        runAuthkitRedirectUrisSet({ environmentId: 'env_1', uris: ['https://a.com/cb'] }),
      ).rejects.toBeInstanceOf(CliExit);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });
  });

  describe('cors', () => {
    it('reads origins from the nested webOrigins shape', async () => {
      mockGraphqlRequest.mockResolvedValue({ webOrigins: { webOrigins: { origins: ['https://app.com'] } } });
      await runAuthkitCorsGet({ environmentId: 'env_1' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('corsConfig'), {
        token: 'tok_123',
        variables: { environmentId: 'env_1' },
        environmentId: 'env_1',
      });
      expect(consoleOutput.join('\n')).toContain('https://app.com');
    });

    it('set maps --origin to flat top-level variables (not an input object)', async () => {
      mockGraphqlRequest.mockResolvedValue({
        setWebOrigins: { __typename: 'WebOriginsSet', origins: ['https://app.com'] },
      });
      await runAuthkitCorsSet({ environmentId: 'env_1', origins: ['https://app.com'] });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('updateCorsConfig'), {
        token: 'tok_123',
        variables: { environmentId: 'env_1', origins: ['https://app.com'], dryRun: false },
        environmentId: 'env_1',
      });
    });

    it('set surfaces a malformed-origin union error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockGraphqlRequest.mockResolvedValue({
        setWebOrigins: { __typename: 'MalformedWebOrigin', message: 'bad', uri: 'nope' },
      });
      await expect(runAuthkitCorsSet({ environmentId: 'env_1', origins: ['nope'] })).rejects.toMatchObject({
        name: 'CliExit',
        context: { errorCode: 'invalid_web_origin' },
      });
    });
  });

  describe('logout-uris', () => {
    it('list passes environmentId', async () => {
      mockGraphqlRequest.mockResolvedValue({
        logoutUris: { data: [{ id: 'lo_1', uri: 'https://app.com/out', isDefault: false }] },
      });
      await runAuthkitLogoutUrisList({ environmentId: 'env_1' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('logoutUris'), {
        token: 'tok_123',
        variables: { environmentId: 'env_1' },
        environmentId: 'env_1',
      });
      expect(consoleOutput.join('\n')).toContain('https://app.com/out');
    });

    it('set maps --uri to the setLogoutUris input', async () => {
      mockGraphqlRequest.mockResolvedValue({
        setLogoutUris: {
          __typename: 'LogoutUrisSet',
          logoutUris: [{ id: 'lo_1', uri: 'https://app.com/out', isDefault: false }],
        },
      });
      await runAuthkitLogoutUrisSet({ environmentId: 'env_1', uris: ['https://app.com/out'] });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('setLogoutUris'), {
        token: 'tok_123',
        variables: { input: { environmentId: 'env_1', logoutUris: [{ uri: 'https://app.com/out' }], dryRun: false } },
        environmentId: 'env_1',
      });
    });
  });

  describe('branding get', () => {
    it('maps to the env-scoped environmentAppBranding op (not the session-scoped appBranding)', async () => {
      mockGraphqlRequest.mockResolvedValue({
        environment: { appBranding: { id: 'br_1', displayName: 'Acme', theme: 'light' } },
      });
      await runAuthkitBrandingGet({ environmentId: 'env_1' });
      const sentDocument = mockGraphqlRequest.mock.calls[0][0] as string;
      expect(sentDocument).toContain('environmentAppBranding');
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('environmentAppBranding'), {
        token: 'tok_123',
        variables: { environmentId: 'env_1' },
        environmentId: 'env_1',
      });
      expect(consoleOutput.join('\n')).toContain('Acme');
    });

    it('emits JSON with no graphql/userland strings', async () => {
      setOutputMode('json');
      mockGraphqlRequest.mockResolvedValue({
        environment: { appBranding: { id: 'br_1', displayName: 'Acme', theme: 'light' } },
      });
      await runAuthkitBrandingGet({ environmentId: 'env_1' });
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland/i);
      const out = JSON.parse(raw);
      expect(out.branding.displayName).toBe('Acme');
    });
  });

  describe('required-flag validation (shared guards)', () => {
    it('cors set requires at least one --origin', async () => {
      await expect(runAuthkitCorsSet({ environmentId: 'env_1', origins: [] })).rejects.toBeInstanceOf(CliExit);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });
    it('logout-uris set requires at least one --uri', async () => {
      await expect(runAuthkitLogoutUrisSet({ environmentId: 'env_1', uris: [] })).rejects.toBeInstanceOf(CliExit);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });
  });

  describe('environment defaulting (previously required --environment-id)', () => {
    it('cors get resolves the environment from the active profile', async () => {
      mockGraphqlRequest.mockResolvedValue({ webOrigins: { webOrigins: { origins: [] } } });
      await runAuthkitCorsGet({});
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('corsConfig'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile' },
        environmentId: 'env_profile',
      });
    });
    it('logout-uris list resolves the environment from the active profile', async () => {
      mockGraphqlRequest.mockResolvedValue({ logoutUris: { data: [] } });
      await runAuthkitLogoutUrisList({});
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('logoutUris'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile' },
        environmentId: 'env_profile',
      });
    });
    it('branding get resolves the environment from the active profile', async () => {
      mockGraphqlRequest.mockResolvedValue({ environment: { appBranding: null } });
      await runAuthkitBrandingGet({});
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('environmentAppBranding'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile' },
        environmentId: 'env_profile',
      });
    });
  });
});
