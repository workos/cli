import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockRequireCommandToken = vi.fn();
const mockGraphqlRequest = vi.fn();
const mockGraphqlUpload = vi.fn();

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
    dashboardGraphqlUpload: (...args: unknown[]) => mockGraphqlUpload(...args),
  };
});

const mockResolveEnvironmentTarget = vi.fn();
vi.mock('../lib/environment-target.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/environment-target.js')>();
  return {
    ...actual,
    resolveEnvironmentTarget: (...args: unknown[]) => mockResolveEnvironmentTarget(...args),
  };
});

const { setOutputMode } = await import('../utils/output.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { runBrandingGet, runBrandingSet } = await import('./branding.js');
const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');

describe('branding command', () => {
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

  describe('get', () => {
    it('maps to the env-scoped environmentAppBranding op (not the session-scoped appBranding)', async () => {
      mockGraphqlRequest.mockResolvedValue({
        environment: { appBranding: { id: 'br_1', displayName: 'Acme', theme: 'light' } },
      });
      await runBrandingGet({ environmentId: 'env_1' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('environmentAppBranding'), {
        token: 'tok_123',
        variables: { environmentId: 'env_1' },
        environmentId: 'env_1',
      });
      expect(consoleOutput.join('\n')).toContain('Acme');
    });

    it('resolves the environment from the active profile', async () => {
      mockGraphqlRequest.mockResolvedValue({ environment: { appBranding: null } });
      await runBrandingGet({});
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('environmentAppBranding'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile' },
        environmentId: 'env_profile',
      });
    });

    it('emits JSON with no graphql/userland strings', async () => {
      setOutputMode('json');
      mockGraphqlRequest.mockResolvedValue({
        environment: { appBranding: { id: 'br_1', displayName: 'Acme', theme: 'light' } },
      });
      await runBrandingGet({ environmentId: 'env_1' });
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland/i);
      expect(JSON.parse(raw).branding.displayName).toBe('Acme');
    });
  });

  describe('set', () => {
    // Real files on disk: the validation path (existence, extension, size) is
    // the point of these tests, so stubbing fs would test nothing.
    let dir: string;
    let logoPath: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'workos-branding-'));
      logoPath = join(dir, 'logo.png');
      await writeFile(logoPath, Buffer.alloc(64, 1));
      mockGraphqlRequest.mockResolvedValue({ environment: { appBranding: { id: 'br_1' } } });
      mockGraphqlUpload.mockResolvedValue({
        updateAppBranding: { __typename: 'AppBrandingUpdated', appBranding: { id: 'br_1', displayName: 'Acme' } },
      });
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    /** The variables object sent on the most recent upload. */
    function sentInput(): Record<string, unknown> {
      const options = mockGraphqlUpload.mock.calls[0][1] as { variables: { input: Record<string, unknown> } };
      return options.variables.input;
    }

    it('reads the branding id, then uploads with a null placeholder per file', async () => {
      await runBrandingSet({ environmentId: 'env_1', logo: logoPath });

      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('environmentAppBranding'), {
        token: 'tok_123',
        variables: { environmentId: 'env_1' },
        environmentId: 'env_1',
      });

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
      await runBrandingSet({ environmentId: 'env_1', logo: logoPath });
      expect(sentInput()).not.toHaveProperty('environmentId');
    });

    it('falls back to naming the environment when no branding record exists yet', async () => {
      mockGraphqlRequest.mockResolvedValue({ environment: { appBranding: null } });
      await runBrandingSet({ environmentId: 'env_1', logo: logoPath });
      expect(sentInput()).toMatchObject({ id: '', environmentId: 'env_1' });
    });

    it('only touches the images that were named', async () => {
      await runBrandingSet({ environmentId: 'env_1', logo: logoPath });
      // An absent field is left alone; a null one would CLEAR that image.
      expect(sentInput()).not.toHaveProperty('darkLogoFile');
      expect(sentInput()).not.toHaveProperty('lightFaviconFile');
    });

    describe('positional form', () => {
      it.each([
        ['logo', 'lightLogoFile'],
        ['logo-dark', 'darkLogoFile'],
        ['icon', 'lightLogoIconFile'],
        ['icon-dark', 'darkLogoIconFile'],
        ['favicon', 'lightFaviconFile'],
        ['favicon-dark', 'darkFaviconFile'],
      ])('`branding set %s <file>` maps to %s', async (slot, field) => {
        await runBrandingSet({ environmentId: 'env_1', slot, file: logoPath });
        expect(sentInput()).toHaveProperty(field, null);
        const options = mockGraphqlUpload.mock.calls[0][1] as { files: Array<{ variablePath: string }> };
        expect(options.files).toHaveLength(1);
        expect(options.files[0]!.variablePath).toBe(`variables.input.${field}`);
      });

      it('rejects an unknown slot without uploading', async () => {
        await expect(runBrandingSet({ environmentId: 'env_1', slot: 'ikon', file: logoPath })).rejects.toBeInstanceOf(
          CliExit,
        );
        expect(mockGraphqlUpload).not.toHaveBeenCalled();
      });

      it('rejects a slot with no file', async () => {
        await expect(runBrandingSet({ environmentId: 'env_1', slot: 'icon' })).rejects.toBeInstanceOf(CliExit);
        expect(mockGraphqlUpload).not.toHaveBeenCalled();
      });

      it('rejects mixing the positional and flag forms', async () => {
        // The two could name the same slot with different files; picking a
        // winner silently would upload the wrong image.
        await expect(
          runBrandingSet({ environmentId: 'env_1', slot: 'icon', file: logoPath, logo: logoPath }),
        ).rejects.toBeInstanceOf(CliExit);
        expect(mockGraphqlUpload).not.toHaveBeenCalled();
      });
    });

    it('maps every flag to its input field', async () => {
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

      await runBrandingSet({ environmentId: 'env_1', ...paths });

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
        expect(options.variables.input[file.variablePath.replace('variables.input.', '')]).toBeNull();
      }
    });

    it('requires at least one image', async () => {
      await expect(runBrandingSet({ environmentId: 'env_1' })).rejects.toBeInstanceOf(CliExit);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
      expect(mockGraphqlUpload).not.toHaveBeenCalled();
    });

    it('rejects an unsupported image type before authenticating', async () => {
      const bad = join(dir, 'logo.bmp');
      await writeFile(bad, Buffer.alloc(16, 1));
      await expect(runBrandingSet({ environmentId: 'env_1', logo: bad })).rejects.toBeInstanceOf(CliExit);
      expect(mockGraphqlUpload).not.toHaveBeenCalled();
    });

    it('rejects a missing file', async () => {
      await expect(runBrandingSet({ environmentId: 'env_1', logo: join(dir, 'nope.png') })).rejects.toBeInstanceOf(
        CliExit,
      );
      expect(mockGraphqlUpload).not.toHaveBeenCalled();
    });

    it('rejects a file over the server size cap without spending the upload', async () => {
      const big = join(dir, 'big.png');
      await writeFile(big, Buffer.alloc(400 * 1024 + 1, 1));
      await expect(runBrandingSet({ environmentId: 'env_1', logo: big })).rejects.toBeInstanceOf(CliExit);
      expect(mockGraphqlUpload).not.toHaveBeenCalled();
    });

    it('validates every file before uploading any of them', async () => {
      const bad = join(dir, 'icon.bmp');
      await writeFile(bad, Buffer.alloc(16, 1));
      await expect(runBrandingSet({ environmentId: 'env_1', logo: logoPath, icon: bad })).rejects.toBeInstanceOf(
        CliExit,
      );
      expect(mockGraphqlUpload).not.toHaveBeenCalled();
    });

    it('surfaces a server-side upload rejection', async () => {
      mockGraphqlUpload.mockResolvedValue({
        updateAppBranding: { __typename: 'AppBrandingUploadAssetsError', errorMessage: 'Invalid file format' },
      });
      await expect(runBrandingSet({ environmentId: 'env_1', logo: logoPath })).rejects.toBeInstanceOf(CliExit);
    });

    it('surfaces a missing branding record', async () => {
      mockGraphqlUpload.mockResolvedValue({ updateAppBranding: { __typename: 'AppBrandingNotFound' } });
      await expect(runBrandingSet({ environmentId: 'env_1', logo: logoPath })).rejects.toBeInstanceOf(CliExit);
    });

    it('pre-validates the environment once, for both requests', async () => {
      await runBrandingSet({ logo: logoPath });
      expect(mockResolveEnvironmentTarget).toHaveBeenCalledTimes(1);
      expect(mockResolveEnvironmentTarget).toHaveBeenCalledWith('tok_123', {
        flagValue: undefined,
        forMutation: true,
      });
    });

    it('emits JSON with no graphql/userland strings', async () => {
      setOutputMode('json');
      await runBrandingSet({ environmentId: 'env_1', slot: 'logo', file: logoPath });
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland/i);
      const out = JSON.parse(raw);
      expect(out.branding.id).toBe('br_1');
      expect(out.uploaded).toEqual([{ asset: 'logo (light)', file: logoPath, bytes: 64 }]);
    });
  });
});
