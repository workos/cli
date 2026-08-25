import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockRequireCommandToken = vi.fn();
const mockGraphqlRequest = vi.fn();
const mockGetActiveEnvironment = vi.fn();
const mockGetConfig = vi.fn();

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

// The environment-target resolver runs REAL against the mocked wire + config
// store, so mutation tests can assert the pre-validation fetch
// (teamProjectsV2) happens before the operation requests.
vi.mock('../lib/config-store.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/config-store.js')>();
  return {
    ...actual,
    getActiveEnvironment: () => mockGetActiveEnvironment(),
    getConfig: () => mockGetConfig(),
    setProfileEnvironmentId: vi.fn(),
  };
});

const { setOutputMode } = await import('../utils/output.js');
const { resetInteractionModeForTests } = await import('../utils/interaction-mode.js');
const { DashboardGraphqlError } = await import('../lib/dashboard-graphql.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { runConfigRedirectAdd, runConfigCorsAdd, runConfigHomepageUrlSet, REDIRECT_MERGE_SCAN_LIMIT } =
  await import('./config.js');

const TEAM_ENVIRONMENTS_PAYLOAD = {
  currentTeam: {
    projectsV2: [{ environments: [{ id: 'env_profile', name: 'Sandbox', sandbox: true, clientId: null }] }],
  },
};

/**
 * Route the wire mock by document content. Ordered: mutation names are checked
 * before the query names they contain (setRedirectUris vs redirectUris).
 */
function respondByDocument(routes: Array<[marker: string, payload: unknown]>): void {
  mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
    const document = String(doc);
    if (document.includes('teamProjectsV2')) return TEAM_ENVIRONMENTS_PAYLOAD;
    for (const [marker, payload] of routes) {
      if (document.includes(marker)) {
        if (payload instanceof Error) throw payload;
        return payload;
      }
    }
    throw new Error(`Unrouted document in test: ${document.slice(0, 80)}`);
  });
}

async function expectExit(promise: Promise<unknown>, code: number): Promise<CliExit> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof CliExit) {
      expect(err.exitCode).toBe(code);
      return err;
    }
    throw err;
  }
  throw new Error(`Expected CliExit(${code}) but promise resolved`);
}

const EXISTING_URIS = {
  redirectUris: {
    data: [
      { id: 'uri_1', uri: 'https://app.example.com/callback', isDefault: true },
      { id: 'uri_2', uri: 'https://staging.example.com/callback', isDefault: false },
    ],
    listMetadata: { before: null, after: null },
  },
};

const URIS_SET = {
  setRedirectUris: {
    __typename: 'RedirectUrisSet',
    redirectUris: [
      { id: 'uri_1', uri: 'https://app.example.com/callback', isDefault: true },
      { id: 'uri_2', uri: 'https://staging.example.com/callback', isDefault: false },
      { id: 'uri_3', uri: 'http://localhost:3000/callback', isDefault: false },
    ],
  },
};

const EXISTING_ORIGINS = { webOrigins: { webOrigins: { origins: ['https://app.example.com'] } } };
const ORIGINS_SET = {
  setWebOrigins: { __typename: 'WebOriginsSet', origins: ['https://app.example.com', 'http://localhost:3000'] },
};

const DEFAULT_APP = { defaultUserlandApplication: { id: 'app_123' } };
const APP_UPDATED = {
  updateUserlandApplication: {
    __typename: 'UserlandApplicationUpdated',
    userlandApplication: { id: 'app_123', appHomepageUrl: 'https://example.com' },
  },
};

describe('config command', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    resetInteractionModeForTests();
    setOutputMode('human');
    mockRequireCommandToken.mockResolvedValue('tok_123');
    mockGetActiveEnvironment.mockReturnValue({ apiKey: 'sk_ignored', environmentId: 'env_profile' });
    mockGetConfig.mockReturnValue({
      activeEnvironment: 'default',
      environments: { default: { apiKey: 'sk_ignored', environmentId: 'env_profile' } },
    });
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetInteractionModeForTests();
    setOutputMode('human');
  });

  describe('redirect add (read-merge-write)', () => {
    it('appends the URI to the current list, preserving ids and defaults (pre-validation → read → write)', async () => {
      respondByDocument([
        ['setRedirectUris', URIS_SET],
        ['redirectUris', EXISTING_URIS],
      ]);
      await runConfigRedirectAdd('http://localhost:3000/callback', {});
      // Mutation: teamProjectsV2 pre-validation, then the merge read, then the set.
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('redirectUris');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { environmentId: 'env_profile', limit: REDIRECT_MERGE_SCAN_LIMIT },
        environmentId: 'env_profile',
      });
      expect(String(mockGraphqlRequest.mock.calls[2][0])).toContain('setRedirectUris');
      expect(mockGraphqlRequest.mock.calls[2][1]).toEqual({
        token: 'tok_123',
        variables: {
          input: {
            environmentId: 'env_profile',
            redirectUris: [
              { id: 'uri_1', uri: 'https://app.example.com/callback', isDefault: true },
              { id: 'uri_2', uri: 'https://staging.example.com/callback', isDefault: false },
              { uri: 'http://localhost:3000/callback' },
            ],
          },
        },
        environmentId: 'env_profile',
      });
      expect(consoleOutput.join('\n')).toContain('Added redirect URI');
    });

    it('no-ops when the URI already exists (no write request)', async () => {
      respondByDocument([
        ['setRedirectUris', URIS_SET],
        ['redirectUris', EXISTING_URIS],
      ]);
      await runConfigRedirectAdd('https://app.example.com/callback', {});
      const documents = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(documents.some((doc) => doc.includes('setRedirectUris'))).toBe(false);
      expect(consoleOutput.join('\n')).toContain('already exists');
    });

    it('refuses loudly when the list is longer than one page (never truncates silently)', async () => {
      respondByDocument([
        ['setRedirectUris', URIS_SET],
        ['redirectUris', { redirectUris: { data: [], listMetadata: { before: null, after: 'cursor_next' } } }],
      ]);
      const err = await expectExit(runConfigRedirectAdd('http://localhost:3000/callback', {}), 1);
      expect(err.context?.errorCode).toBe('too_many_uris');
      const documents = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(documents.some((doc) => doc.includes('setRedirectUris'))).toBe(false);
    });

    it('errors invalid_redirect_uri on a rejected URI', async () => {
      respondByDocument([
        [
          'setRedirectUris',
          {
            setRedirectUris: {
              __typename: 'InvalidRedirectUriError',
              message: 'Redirect URI must use HTTPS',
              uri: 'ftp://bad',
            },
          },
        ],
        ['redirectUris', EXISTING_URIS],
      ]);
      const err = await expectExit(runConfigRedirectAdd('ftp://bad', {}), 1);
      expect(err.context?.errorCode).toBe('invalid_redirect_uri');
    });

    it('honors an --environment-id override', async () => {
      respondByDocument([
        ['setRedirectUris', URIS_SET],
        ['redirectUris', EXISTING_URIS],
      ]);
      await runConfigRedirectAdd('http://localhost:3000/callback', { environmentId: 'env_profile' });
      expect(mockGraphqlRequest.mock.calls[1][1]).toMatchObject({ environmentId: 'env_profile' });
    });

    it('--json emits { uri, alreadyExists: false } on add', async () => {
      setOutputMode('json');
      respondByDocument([
        ['setRedirectUris', URIS_SET],
        ['redirectUris', EXISTING_URIS],
      ]);
      await runConfigRedirectAdd('http://localhost:3000/callback', {});
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland/i);
      expect(JSON.parse(raw)).toEqual({ uri: 'http://localhost:3000/callback', alreadyExists: false });
    });

    it('--json emits { uri, alreadyExists: true } on a no-op', async () => {
      setOutputMode('json');
      respondByDocument([
        ['setRedirectUris', URIS_SET],
        ['redirectUris', EXISTING_URIS],
      ]);
      await runConfigRedirectAdd('https://app.example.com/callback', {});
      expect(JSON.parse(consoleOutput[0])).toEqual({ uri: 'https://app.example.com/callback', alreadyExists: true });
    });
  });

  describe('cors add (read-merge-write)', () => {
    it('appends the origin to the current list (pre-validation → read → write)', async () => {
      respondByDocument([
        ['updateCorsConfig', ORIGINS_SET],
        ['corsConfig', EXISTING_ORIGINS],
      ]);
      await runConfigCorsAdd('http://localhost:3000', {});
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('corsConfig');
      expect(String(mockGraphqlRequest.mock.calls[2][0])).toContain('updateCorsConfig');
      expect(mockGraphqlRequest.mock.calls[2][1]).toEqual({
        token: 'tok_123',
        variables: { environmentId: 'env_profile', origins: ['https://app.example.com', 'http://localhost:3000'] },
        environmentId: 'env_profile',
      });
      expect(consoleOutput.join('\n')).toContain('Added CORS origin');
    });

    it('no-ops when the origin already exists (no write request)', async () => {
      respondByDocument([
        ['updateCorsConfig', ORIGINS_SET],
        ['corsConfig', EXISTING_ORIGINS],
      ]);
      await runConfigCorsAdd('https://app.example.com', {});
      const documents = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(documents.some((doc) => doc.includes('updateCorsConfig'))).toBe(false);
      expect(consoleOutput.join('\n')).toContain('already exists');
    });

    it('errors invalid_web_origin on a rejected origin', async () => {
      respondByDocument([
        [
          'updateCorsConfig',
          {
            setWebOrigins: {
              __typename: 'MalformedWebOrigin',
              message: 'Not a valid origin',
              uri: 'nonsense',
            },
          },
        ],
        ['corsConfig', EXISTING_ORIGINS],
      ]);
      const err = await expectExit(runConfigCorsAdd('nonsense', {}), 1);
      expect(err.context?.errorCode).toBe('invalid_web_origin');
    });

    it('rejects wildcard origins before reading the current list', async () => {
      const err = await expectExit(runConfigCorsAdd('*', {}), 1);
      expect(err.context?.errorCode).toBe('invalid_web_origin');
      const err2 = await expectExit(runConfigCorsAdd('https://*.example.com', {}), 1);
      expect(err2.context?.errorCode).toBe('invalid_web_origin');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('--json emits { origin, alreadyExists }', async () => {
      setOutputMode('json');
      respondByDocument([
        ['updateCorsConfig', ORIGINS_SET],
        ['corsConfig', EXISTING_ORIGINS],
      ]);
      await runConfigCorsAdd('http://localhost:3000', {});
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland/i);
      expect(JSON.parse(raw)).toEqual({ origin: 'http://localhost:3000', alreadyExists: false });
    });
  });

  describe('homepage-url set (two-step: resolve application, then update)', () => {
    it('resolves the AuthKit application, then sets the homepage URL on it', async () => {
      respondByDocument([
        ['updateAuthkitApplication', APP_UPDATED],
        ['defaultAuthkitApplication', DEFAULT_APP],
      ]);
      await runConfigHomepageUrlSet('https://example.com', {});
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('defaultAuthkitApplication');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { environmentId: 'env_profile' },
        environmentId: 'env_profile',
      });
      expect(String(mockGraphqlRequest.mock.calls[2][0])).toContain('updateAuthkitApplication');
      expect(mockGraphqlRequest.mock.calls[2][1]).toEqual({
        token: 'tok_123',
        variables: { input: { applicationId: 'app_123', appHomepageUrl: 'https://example.com' } },
        environmentId: 'env_profile',
      });
      expect(consoleOutput.join('\n')).toContain('Set homepage URL');
    });

    it('errors not_found when the environment has no AuthKit application', async () => {
      respondByDocument([
        ['updateAuthkitApplication', APP_UPDATED],
        ['defaultAuthkitApplication', { defaultUserlandApplication: null }],
      ]);
      const err = await expectExit(runConfigHomepageUrlSet('https://example.com', {}), 1);
      expect(err.context?.errorCode).toBe('not_found');
      const documents = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(documents.some((doc) => doc.includes('updateAuthkitApplication'))).toBe(false);
    });

    it('errors not_found when the update reports the application missing', async () => {
      respondByDocument([
        [
          'updateAuthkitApplication',
          { updateUserlandApplication: { __typename: 'UserlandApplicationNotFound', applicationId: 'app_123' } },
        ],
        ['defaultAuthkitApplication', DEFAULT_APP],
      ]);
      const err = await expectExit(runConfigHomepageUrlSet('https://example.com', {}), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('errors invalid_argument with the server message on validation failure', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      respondByDocument([
        [
          'updateAuthkitApplication',
          {
            updateUserlandApplication: {
              __typename: 'UserlandApplicationValidationFailed',
              message: 'The app homepage URL must be a valid URL.',
            },
          },
        ],
        ['defaultAuthkitApplication', DEFAULT_APP],
      ]);
      const err = await expectExit(runConfigHomepageUrlSet('nonsense', {}), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      expect(consoleErrors.join('\n')).toContain('valid URL');
    });

    it('errors unexpected_result on an unknown variant', async () => {
      respondByDocument([
        ['updateAuthkitApplication', { updateUserlandApplication: { __typename: 'SomethingElse' } }],
        ['defaultAuthkitApplication', DEFAULT_APP],
      ]);
      const err = await expectExit(runConfigHomepageUrlSet('https://example.com', {}), 1);
      expect(err.context?.errorCode).toBe('unexpected_result');
    });

    it('--json emits { homepageUrl, applicationId } without internal naming', async () => {
      setOutputMode('json');
      respondByDocument([
        ['updateAuthkitApplication', APP_UPDATED],
        ['defaultAuthkitApplication', DEFAULT_APP],
      ]);
      await runConfigHomepageUrlSet('https://example.com', {});
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland/i);
      expect(JSON.parse(raw)).toEqual({ homepageUrl: 'https://example.com', applicationId: 'app_123' });
    });
  });

  describe('shared failure modes', () => {
    it('exits auth-required (code 4) when not logged in', async () => {
      mockRequireCommandToken.mockImplementation(() => {
        throw new CliExit(4, { reason: 'auth_required', errorCode: 'auth_required' });
      });
      await expectExit(runConfigRedirectAdd('http://localhost:3000/callback', {}), 4);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('surfaces the gated-capability case on a 403 without naming GraphQL', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      respondByDocument([
        [
          'redirectUris',
          new DashboardGraphqlError('The dashboard GraphQL API rejected this session (HTTP 403).', 'forbidden', 403),
        ],
      ]);
      await expectExit(runConfigRedirectAdd('http://localhost:3000/callback', {}), 1);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });
  });
});
