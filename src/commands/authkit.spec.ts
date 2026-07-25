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

const mockGraphqlUpload = vi.fn();

vi.mock('../lib/dashboard-graphql.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/dashboard-graphql.js')>();
  return {
    ...actual,
    dashboardGraphqlRequest: (...args: unknown[]) => mockGraphqlRequest(...args),
    dashboardGraphqlUpload: (...args: unknown[]) => mockGraphqlUpload(...args),
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
  runAuthkitBrandingSet,
} = await import('./authkit.js');
const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');

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

    it('set rejects wildcard origins before any request is made', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(
        runAuthkitCorsSet({ environmentId: 'env_1', origins: ['https://app.com', '*'] }),
      ).rejects.toMatchObject({ name: 'CliExit', context: { errorCode: 'invalid_web_origin' } });
      await expect(
        runAuthkitCorsSet({ environmentId: 'env_1', origins: ['https://*.example.com'] }),
      ).rejects.toMatchObject({ name: 'CliExit', context: { errorCode: 'invalid_web_origin' } });
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
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

  describe('branding set', () => {
    // Real files on disk: the validation path (existence, extension, size) is
    // the point of these tests, so stubbing fs would test nothing.
    let dir: string;
    let logoPath: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'workos-branding-'));
      logoPath = join(dir, 'logo.png');
      await writeFile(logoPath, Buffer.alloc(64, 1));
      // The id lookup that precedes every upload.
      mockGraphqlRequest.mockResolvedValue({ environment: { appBranding: { id: 'br_1' } } });
      mockGraphqlUpload.mockResolvedValue({
        updateAppBranding: { __typename: 'AppBrandingUpdated', appBranding: { id: 'br_1', displayName: 'Acme' } },
      });
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('reads the branding id, then uploads with a null placeholder per file', async () => {
      await runAuthkitBrandingSet({ environmentId: 'env_1', logo: logoPath });

      // Step 1: env-scoped read to address the branding record.
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('environmentAppBranding'), {
        token: 'tok_123',
        variables: { environmentId: 'env_1' },
        environmentId: 'env_1',
      });

      // Step 2: multipart mutation. The image field must be null in the
      // variables — the file part is what fills it.
      const [document, options] = mockGraphqlUpload.mock.calls[0] as [string, Record<string, never>];
      expect(document).toContain('updateAppBranding');
      expect(options).toMatchObject({
        token: 'tok_123',
        environmentId: 'env_1',
        variables: { input: { id: 'br_1', lightLogoFile: null } },
      });
      expect(options.files).toEqual([
        {
          variablePath: 'variables.input.lightLogoFile',
          filename: 'logo.png',
          contentType: 'image/png',
          bytes: expect.anything(),
        },
      ]);
    });

    it('addresses the record by id and does not send environmentId in the input', async () => {
      // Sending `environmentId` would force the environment-scoped write path,
      // which AuthKit does not render unless per-environment branding is on.
      // Passing only `id` lets the server pick the correct scope.
      await runAuthkitBrandingSet({ environmentId: 'env_1', logo: logoPath });
      const options = mockGraphqlUpload.mock.calls[0][1] as { variables: { input: Record<string, unknown> } };
      expect(options.variables.input).not.toHaveProperty('environmentId');
    });

    it('falls back to naming the environment when no branding record exists yet', async () => {
      mockGraphqlRequest.mockResolvedValue({ environment: { appBranding: null } });
      await runAuthkitBrandingSet({ environmentId: 'env_1', logo: logoPath });
      const options = mockGraphqlUpload.mock.calls[0][1] as { variables: { input: Record<string, unknown> } };
      expect(options.variables.input).toMatchObject({ id: '', environmentId: 'env_1' });
    });

    it('maps every asset flag to its input field', async () => {
      const paths: Record<string, string> = {};
      for (const [option, file] of [
        ['logo', 'logo.png'],
        ['logoDark', 'logo-dark.png'],
        ['icon', 'icon.png'],
        ['iconDark', 'icon-dark.png'],
        ['favicon', 'favicon.ico'],
        ['faviconDark', 'favicon-dark.ico'],
      ]) {
        const path = join(dir, file!);
        await writeFile(path, Buffer.alloc(16, 1));
        paths[option!] = path;
      }

      await runAuthkitBrandingSet({ environmentId: 'env_1', ...paths });

      const options = mockGraphqlUpload.mock.calls[0][1] as {
        variables: { input: Record<string, unknown> };
        files: Array<{ variablePath: string }>;
      };
      expect(
        Object.keys(options.variables.input)
          .filter((key) => key.endsWith('File'))
          .sort(),
      ).toEqual([
        'darkFaviconFile',
        'darkLogoFile',
        'darkLogoIconFile',
        'lightFaviconFile',
        'lightLogoFile',
        'lightLogoIconFile',
      ]);
      // Every declared path points at a slot that is null.
      for (const file of options.files) {
        const field = file.variablePath.replace('variables.input.', '');
        expect(options.variables.input[field]).toBeNull();
      }
    });

    it('only touches the images that were passed', async () => {
      await runAuthkitBrandingSet({ environmentId: 'env_1', logo: logoPath });
      const options = mockGraphqlUpload.mock.calls[0][1] as { variables: { input: Record<string, unknown> } };
      // An absent field is left alone; a null one would CLEAR that image.
      expect(options.variables.input).not.toHaveProperty('darkLogoFile');
      expect(options.variables.input).not.toHaveProperty('lightFaviconFile');
    });

    it('requires at least one image', async () => {
      await expect(runAuthkitBrandingSet({ environmentId: 'env_1' })).rejects.toBeInstanceOf(CliExit);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
      expect(mockGraphqlUpload).not.toHaveBeenCalled();
    });

    it('rejects an unsupported image type before authenticating', async () => {
      const bad = join(dir, 'logo.bmp');
      await writeFile(bad, Buffer.alloc(16, 1));
      await expect(runAuthkitBrandingSet({ environmentId: 'env_1', logo: bad })).rejects.toBeInstanceOf(CliExit);
      expect(mockGraphqlUpload).not.toHaveBeenCalled();
    });

    it('rejects a missing file', async () => {
      await expect(
        runAuthkitBrandingSet({ environmentId: 'env_1', logo: join(dir, 'nope.png') }),
      ).rejects.toBeInstanceOf(CliExit);
      expect(mockGraphqlUpload).not.toHaveBeenCalled();
    });

    it('rejects a file over the server size cap without spending the upload', async () => {
      const big = join(dir, 'big.png');
      await writeFile(big, Buffer.alloc(400 * 1024 + 1, 1));
      await expect(runAuthkitBrandingSet({ environmentId: 'env_1', logo: big })).rejects.toBeInstanceOf(CliExit);
      expect(mockGraphqlUpload).not.toHaveBeenCalled();
    });

    it('validates every file before uploading any of them', async () => {
      const bad = join(dir, 'icon.bmp');
      await writeFile(bad, Buffer.alloc(16, 1));
      await expect(runAuthkitBrandingSet({ environmentId: 'env_1', logo: logoPath, icon: bad })).rejects.toBeInstanceOf(
        CliExit,
      );
      expect(mockGraphqlUpload).not.toHaveBeenCalled();
    });

    it('surfaces a server-side upload rejection', async () => {
      mockGraphqlUpload.mockResolvedValue({
        updateAppBranding: { __typename: 'AppBrandingUploadAssetsError', errorMessage: 'Invalid file format' },
      });
      await expect(runAuthkitBrandingSet({ environmentId: 'env_1', logo: logoPath })).rejects.toBeInstanceOf(CliExit);
    });

    it('surfaces a missing branding record', async () => {
      mockGraphqlUpload.mockResolvedValue({ updateAppBranding: { __typename: 'AppBrandingNotFound' } });
      await expect(runAuthkitBrandingSet({ environmentId: 'env_1', logo: logoPath })).rejects.toBeInstanceOf(CliExit);
    });

    it('pre-validates the environment once, for both requests', async () => {
      await runAuthkitBrandingSet({ logo: logoPath });
      expect(mockResolveEnvironmentTarget).toHaveBeenCalledTimes(1);
      expect(mockResolveEnvironmentTarget).toHaveBeenCalledWith('tok_123', {
        flagValue: undefined,
        forMutation: true,
      });
    });

    it('emits JSON with no graphql/userland strings', async () => {
      setOutputMode('json');
      await runAuthkitBrandingSet({ environmentId: 'env_1', logo: logoPath });
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland/i);
      const out = JSON.parse(raw);
      expect(out.branding.id).toBe('br_1');
      expect(out.uploaded).toEqual([{ asset: 'logo (light)', file: logoPath, bytes: 64 }]);
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
