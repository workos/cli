import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('./config-store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config-store.js')>()),
  getActiveEnvironment: vi.fn(),
}));
vi.mock('./command-auth.js', () => ({ refreshIfExpired: vi.fn() }));
vi.mock('./ensure-auth.js', () => ({ ensureAuthenticated: vi.fn() }));
vi.mock('./credentials.js', () => ({ getAccessToken: vi.fn() }));
vi.mock('./staging-api.js', () => ({ fetchStagingCredentials: vi.fn() }));
vi.mock('./validation/index.js', () => ({ validateInstallation: vi.fn() }));
vi.mock('./api-key.js', () => ({
  resolveApiBaseUrl: () => 'https://api.workos.com',
  resolveApiKey: vi.fn(),
}));
vi.mock('./environment-target.js', () => ({ fetchTeamEnvironments: vi.fn() }));
vi.mock('./dashboard-graphql.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dashboard-graphql.js')>()),
  dashboardGraphqlRequest: vi.fn(),
}));
vi.mock('../catalog/operation.js', () => ({
  getOperation: (name: string) => ({ name }),
  resolveExecutableDocument: (operation: { name: string }) => operation.name,
}));

import { getActiveEnvironment } from './config-store.js';
import { refreshIfExpired } from './command-auth.js';
import { fetchTeamEnvironments } from './environment-target.js';
import { ensureAuthenticated } from './ensure-auth.js';
import { getAccessToken } from './credentials.js';
import { fetchStagingCredentials } from './staging-api.js';
import { validateInstallation } from './validation/index.js';
import ui, { CANCEL, setUiHost } from '../utils/ui.js';
import { setInteractionMode, resetInteractionModeForTests } from '../utils/interaction-mode.js';
import { setOutputMode } from '../utils/output.js';
import { CliExit } from '../utils/cli-exit.js';
import { dashboardGraphqlRequest, DashboardGraphqlError } from './dashboard-graphql.js';
import {
  buildApplicationSetup,
  configureAuthkitApplication,
  readNextjsApplicationSetup,
} from './authkit-application-setup.js';
import {
  configureInstallEnvironment,
  configureOtherApplicationUrls,
  configureNextjsApplicationUrls,
} from './run-with-core.js';
import { createInstallerEventEmitter } from './events.js';
import { applicationSetupNextSteps } from './completion-data.js';

const setup = {
  clientId: 'client_app',
  redirectUri: 'http://localhost:4000/callback',
  signOutUri: 'http://localhost:4000/',
  initiateLoginUri: 'http://localhost:4000/sign-in',
  verified: false,
};
let application: {
  id: string;
  clientId: string;
  redirectUris: { uri: string; isDefault?: boolean }[];
  logoutUris: { id?: string; uri: string; isDefault: boolean }[];
  initiateLoginUri: string | null;
  appHomepageUrl?: string;
  webOrigins: { origin: string }[];
};
const writes = () =>
  vi
    .mocked(dashboardGraphqlRequest)
    .mock.calls.filter(
      ([name, options]) =>
        name !== 'defaultAuthkitApplication' && !(options.variables?.input as { dryRun?: boolean })?.dryRun,
    );

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected network request');
    }),
  );
  vi.mocked(getActiveEnvironment).mockReturnValue(null);
  vi.mocked(refreshIfExpired).mockResolvedValue({ accessToken: 'test-token', refreshed: false });
  vi.mocked(fetchTeamEnvironments).mockResolvedValue([
    { id: 'env_app', name: 'Sandbox', sandbox: true, clientId: setup.clientId },
  ]);
  application = {
    id: 'app_1',
    webOrigins: [{ origin: 'https://custom.example' }],
    clientId: setup.clientId,
    redirectUris: [{ uri: setup.redirectUri, isDefault: true }],
    logoutUris: [{ id: 'uri_old', uri: 'https://old.example/', isDefault: false }],
    initiateLoginUri: null,
    appHomepageUrl: 'https://existing.example/',
  };
  vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
    if (name === 'defaultAuthkitApplication') return { defaultUserlandApplication: structuredClone(application) };
    if (name === 'setAuthkitApplicationWebOrigins') {
      const input = options.variables!.input as { applicationId: string; origins: string[]; dryRun: boolean };
      expect(input.applicationId).toBe('app_1');
      if (!input.dryRun) application.webOrigins = input.origins.map((origin) => ({ origin }));
      return { setUserlandApplicationWebOrigins: { __typename: 'WebOriginsSet' } };
    }
    if (name === 'setAuthkitApplicationLogoutUris') {
      const input = options.variables!.input as {
        applicationId: string;
        logoutUris: typeof application.logoutUris;
        dryRun: boolean;
      };
      expect(input.applicationId).toBe('app_1');
      if (!input.dryRun) application.logoutUris = input.logoutUris;
      return { setUserlandApplicationLogoutUris: { __typename: 'LogoutUrisSet' } };
    }
    if (name === 'setRedirectUris') {
      const input = options.variables!.input as {
        environmentId: string;
        redirectUris: typeof application.redirectUris;
        dryRun: boolean;
      };
      // applicationId here resolves an AuthKit IDP application, not the userland
      // app returned by defaultAuthkitApplication. Match the live API contract.
      if ('applicationId' in input) throw new Error("Application not found: 'app_1'.");
      expect(input.environmentId).toBe('env_app');
      if (!input.dryRun) application.redirectUris = input.redirectUris;
      return { setRedirectUris: { __typename: 'RedirectUrisSet' } };
    }
    if (name === 'updateAuthkitApplication') {
      const input = options.variables!.input as {
        applicationId: string;
        initiateLoginUri?: string;
        appHomepageUrl?: string;
      };
      expect(input.applicationId).toBe('app_1');
      if (input.initiateLoginUri !== undefined) application.initiateLoginUri = input.initiateLoginUri;
      if (input.appHomepageUrl !== undefined) application.appHomepageUrl = input.appHomepageUrl;
      return { updateUserlandApplication: { __typename: 'UserlandApplicationUpdated' } };
    }
    throw new Error(`Unexpected operation: ${name}`);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('native application URL setup', () => {
  it.each([false, true])(
    'uses only client B dashboard even when session appears after preparation (%s)',
    async (lateSession) => {
      const directory = await mkdtemp(join(tmpdir(), 'single-target-'));
      const request = vi.fn(async () => Response.json({ url: null }));
      vi.stubGlobal('fetch', request);
      const context = {
        options: { installDir: directory, debug: false, forceInstall: false, local: false, ci: true, skipAuth: true },
        integration: 'sveltekit',
        credentials: { apiKey: 'sk_test_environment_a', clientId: setup.clientId },
        emitter: createInstallerEventEmitter(),
      };
      try {
        if (lateSession) vi.mocked(refreshIfExpired).mockResolvedValue(null);
        await configureInstallEnvironment(context);
        expect(request).not.toHaveBeenCalled();
        vi.mocked(refreshIfExpired).mockResolvedValue({ accessToken: 'session_b', refreshed: false });
        const result = await configureOtherApplicationUrls(context, setup.clientId, context.credentials.apiKey);
        expect(result?.corsRegistered).toBe(true);
        expect(writes().map(([name]) => name)).toContain('setAuthkitApplicationWebOrigins');
        expect(writes().map(([name]) => name)).toContain('setRedirectUris');
        expect(request).not.toHaveBeenCalled();
        for (const [, options] of vi.mocked(dashboardGraphqlRequest).mock.calls) {
          expect(options.environmentId).toBe('env_app');
          expect(options.token).toBe('session_b');
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it('appends dashboard CORS without replacing custom origins and is idempotent', async () => {
    const withCors = { ...setup, corsOrigin: 'http://localhost:4000' };
    expect((await configureAuthkitApplication(withCors, setup.clientId)).corsRegistered).toBe(true);
    expect(application.webOrigins).toEqual([{ origin: 'https://custom.example' }, { origin: withCors.corsOrigin }]);
    const corsCalls = () =>
      vi.mocked(dashboardGraphqlRequest).mock.calls.filter(([name]) => name === 'setAuthkitApplicationWebOrigins');
    expect(corsCalls().map(([, options]) => options.variables!.input)).toEqual([
      { applicationId: 'app_1', origins: ['https://custom.example', withCors.corsOrigin], dryRun: true },
      { applicationId: 'app_1', origins: ['https://custom.example', withCors.corsOrigin], dryRun: false },
    ]);
    expect((await configureAuthkitApplication(withCors, setup.clientId)).corsRegistered).toBe(true);
    expect(corsCalls()).toHaveLength(2);
  });

  it.each(['validation', 'race', 'readback', 'missing'])(
    'refuses unsafe dashboard CORS (%s) without API fallback',
    async (failure) => {
      const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
      if (failure === 'missing') delete (application as Partial<typeof application>).webOrigins;
      vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
        if (name === 'setAuthkitApplicationWebOrigins') {
          const input = options.variables!.input as { dryRun: boolean };
          if (failure === 'validation')
            return { setUserlandApplicationWebOrigins: { __typename: 'MalformedWebOrigin' } };
          if (failure === 'race' && input.dryRun) application.webOrigins.push({ origin: 'https://concurrent.example' });
          if (failure === 'readback' && !input.dryRun)
            return { setUserlandApplicationWebOrigins: { __typename: 'WebOriginsSet' } };
        }
        return original(name, options);
      });
      const result = await configureAuthkitApplication(
        { ...setup, corsOrigin: 'http://localhost:4000' },
        setup.clientId,
        'sk_test_environment_a',
      );
      expect(result.callbackRegistered).toBe(true);
      expect(result.corsRegistered).toBe(false);
      expect(result.verified).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
      if (failure !== 'readback') expect(writes()).toHaveLength(0);
    },
  );

  it('registers API-only CORS before leaving an unreadable existing homepage unchanged', async () => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    const request = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', request);
    const result = await configureAuthkitApplication(
      { ...setup, corsOrigin: 'http://localhost:4000' },
      setup.clientId,
      'sk_test_environment_a',
    );
    expect(result.corsRegistered).toBe(true);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'https://api.workos.com/user_management/redirect_uris',
      'https://api.workos.com/user_management/cors_origins',
    ]);
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
  });

  it.each(['explicit', 'unclaimed'])('preserves API-only fresh-install CORS and homepage setup (%s)', async (kind) => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    if (kind === 'unclaimed')
      vi.mocked(getActiveEnvironment).mockReturnValue({
        name: 'Unclaimed',
        type: 'unclaimed',
        apiKey: 'sk_test_environment_a',
        clientId: setup.clientId,
        claimToken: 'claim',
      });
    const request = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/claim-nonces')) return Response.json({ nonce: 'claim_nonce' });
      return init.method === 'GET' ? new Response(null, { status: 404 }) : Response.json({});
    });
    vi.stubGlobal('fetch', request);
    const result = await configureAuthkitApplication(
      {
        ...setup,
        corsOrigin: 'http://localhost:4000',
        ...(kind === 'explicit' ? { homepageUrl: 'http://localhost:4000' } : {}),
      },
      setup.clientId,
      'sk_test_environment_a',
    );
    expect(result).toMatchObject({ callbackRegistered: true, corsRegistered: true, verified: false });
    expect(request).toHaveBeenCalledWith(
      'https://api.workos.com/user_management/app_homepage_url',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ url: 'http://localhost:4000' }) }),
    );
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
  });

  it.each([undefined, 'sk_live_production'])(
    'does not write API-only CORS without a sandbox key (%s)',
    async (apiKey) => {
      vi.mocked(refreshIfExpired).mockResolvedValue(null);
      await expect(
        configureAuthkitApplication({ ...setup, corsOrigin: 'http://localhost:4000' }, setup.clientId, apiKey),
      ).rejects.toThrow(/Callback/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('keeps production dashboard CORS read-only', async () => {
    vi.mocked(fetchTeamEnvironments).mockResolvedValue([
      { id: 'env_app', name: 'Production', sandbox: false, clientId: setup.clientId },
    ]);
    const result = await configureAuthkitApplication(
      { ...setup, corsOrigin: 'http://localhost:4000' },
      setup.clientId,
      'sk_test_environment_a',
    );
    expect(result.corsRegistered).toBe(false);
    expect(writes()).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('registers the callback with an API key without a dashboard session', async () => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    const request = vi.fn(async () => Response.json({ url: null }));
    vi.stubGlobal('fetch', request);
    const result = await configureAuthkitApplication(setup, setup.clientId, 'sk_test_unclaimed');
    expect(request).toHaveBeenCalledWith(
      'https://api.workos.com/user_management/redirect_uris',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk_test_unclaimed' }),
        body: JSON.stringify({ uri: setup.redirectUri }),
      }),
    );
    expect(result.callbackRegistered).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('Sign-out URI and Initiate login URI');
    expect(applicationSetupNextSteps(result)).toContain(`Redirect URI: ${setup.redirectUri} (registered)`);
    expect(fetchTeamEnvironments).not.toHaveBeenCalled();
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
  });

  it('accepts an already registered API-only callback without claiming full setup', async () => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) =>
        init.method === 'POST'
          ? new Response('{"message":"already exists"}', { status: 409 })
          : Response.json({ url: 'https://existing.example/' }),
      ),
    );
    const result = await configureAuthkitApplication(setup, setup.clientId, 'sk_test_unclaimed');
    expect(result.callbackRegistered).toBe(true);
    expect(result.verified).toBe(false);
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
  });

  it('fails the install when the API-only callback cannot be registered', async () => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"private details"}', { status: 403 })),
    );
    await expect(configureAuthkitApplication(setup, setup.clientId, 'sk_test_unclaimed')).rejects.toThrow(
      'Could not register the callback URL',
    );
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
  });

  it.each(['sk_live_production', 'sk_unknown'])(
    'refuses API-only callback writes without a sandbox key (%s)',
    async (apiKey) => {
      vi.mocked(refreshIfExpired).mockResolvedValue(null);
      const request = vi.fn();
      vi.stubGlobal('fetch', request);
      await expect(configureAuthkitApplication(setup, setup.clientId, apiKey)).rejects.toThrow('sandbox API key');
      expect(request).not.toHaveBeenCalled();
      expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
    },
  );

  it('never combines API-key writes with dashboard writes, even after a partial failure', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    application.redirectUris = [];
    expect((await configureAuthkitApplication(setup, setup.clientId, 'sk_test_other_environment')).verified).toBe(true);
    expect(writes()).toHaveLength(3);
    expect(request).not.toHaveBeenCalled();
    vi.mocked(dashboardGraphqlRequest).mockRejectedValue(new Error('dashboard unavailable'));
    await expect(configureAuthkitApplication(setup, setup.clientId, 'sk_test_other_environment')).rejects.toThrow(
      /Callback/,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('validates, preserves existing URLs, writes to the matched application, and reads back', async () => {
    const result = await configureAuthkitApplication(setup, setup.clientId);
    expect(result.verified).toBe(true);
    expect(application.logoutUris).toContainEqual({ id: 'uri_old', uri: 'https://old.example/', isDefault: false });
    expect(application.logoutUris).toContainEqual({ uri: setup.signOutUri, isDefault: true });
    expect(application.initiateLoginUri).toBe(setup.initiateLoginUri);
    expect(fetchTeamEnvironments).toHaveBeenCalledTimes(1);
    for (const [, options] of vi.mocked(dashboardGraphqlRequest).mock.calls)
      expect(options.environmentId).toBe('env_app');
    expect(vi.mocked(dashboardGraphqlRequest).mock.calls.at(-1)?.[0]).toBe('defaultAuthkitApplication');
    expect(writes()).toHaveLength(2);
  });

  it('sets the sign-out URI and leaves the initiate login URI alone when the app has no sign-in route', async () => {
    const { initiateLoginUri: _omitted, ...withoutSignIn } = setup;
    application.redirectUris = [];
    delete application.appHomepageUrl;
    const result = await configureAuthkitApplication(withoutSignIn, setup.clientId);
    expect(result.verified).toBe(false);
    expect(result.callbackRegistered).toBe(true);
    expect(result.signOutRegistered).toBe(true);
    expect(applicationSetupNextSteps(result)).toContain(`Sign-out URI: ${setup.signOutUri} (registered)`);
    expect(result.initiateLoginReason).toContain('No client sign-in route');
    expect(result.reason).toBe(result.initiateLoginReason);
    expect(application.appHomepageUrl).toBe('http://localhost:4000');
    expect(application.logoutUris).toContainEqual({ uri: setup.signOutUri, isDefault: true });
    expect(application.initiateLoginUri).toBeNull();
    for (const [name, options] of writes())
      if (name === 'updateAuthkitApplication') expect(options.variables?.input).not.toHaveProperty('initiateLoginUri');
  });

  it('does not report an existing initiate login URI as a conflict when the app has no sign-in route', async () => {
    application.initiateLoginUri = 'http://localhost:4000/login';
    const { initiateLoginUri: _omitted, ...withoutSignIn } = setup;
    const initiateLoginReason = 'The client sign-in route is missing.';
    const result = await configureAuthkitApplication({ ...withoutSignIn, initiateLoginReason }, setup.clientId);
    expect(result.verified).toBe(false);
    expect(result.initiateLoginReason).toBe(initiateLoginReason);
    expect(result.reason).toBe(initiateLoginReason);
    expect(result.reason).not.toContain('differs from this app');
    expect(application.initiateLoginUri).toBe('http://localhost:4000/login');
    expect(applicationSetupNextSteps(result)).toContain(
      `Initiate login URI: not configured by the installer. ${initiateLoginReason}`,
    );
  });

  it('does not mark sign-out registered when its readback fails and initiate login is pending', async () => {
    const { initiateLoginUri: _omitted, ...withoutSignIn } = setup;
    const respond = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      if (name === 'setAuthkitApplicationLogoutUris')
        return { setUserlandApplicationLogoutUris: { __typename: 'LogoutUrisSet' } };
      return respond(name, options);
    });
    const result = await configureAuthkitApplication(withoutSignIn, setup.clientId);
    expect(result.verified).toBe(false);
    expect(result.signOutRegistered).toBe(false);
    expect(result.reason).toContain('URL read-back did not match');
    expect(result.reason).toContain('No client sign-in route');
    expect(applicationSetupNextSteps(result)).toContain(
      `Sign-out URI: ${setup.signOutUri} (not registered or verified)`,
    );
  });

  it('does not trust a sign-out result from a previous attempt on the API-only path', async () => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 201 })),
    );
    const result = await configureAuthkitApplication(
      { ...setup, signOutRegistered: true },
      setup.clientId,
      'sk_test_a',
    );
    expect(result.signOutRegistered).toBe(false);
    expect(result.verified).toBe(false);
  });

  it('fills an empty dashboard homepage with the callback origin', async () => {
    delete application.appHomepageUrl;
    expect((await configureAuthkitApplication(setup, setup.clientId)).verified).toBe(true);
    expect(application.appHomepageUrl).toBe('http://localhost:4000');
  });

  it('writes the API-only homepage for the matching stored unclaimed key despite GET 404', async () => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    vi.mocked(getActiveEnvironment).mockReturnValue({
      name: 'Unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_unclaimed',
      clientId: setup.clientId,
      claimToken: 'claim',
    });
    const request = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/claim-nonces')) return Response.json({ nonce: 'claim_nonce' });
      return init.method === 'GET' ? new Response(null, { status: 404 }) : Response.json({});
    });
    vi.stubGlobal('fetch', request);
    const result = await configureAuthkitApplication(setup, setup.clientId, 'sk_test_unclaimed');
    expect(request).toHaveBeenCalledWith(
      'https://api.workos.com/x/one-shot-environments/claim-nonces',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ client_id: setup.clientId, claim_token: 'claim' }),
      }),
    );
    expect(request.mock.calls.filter(([, init]) => init.method !== 'GET').map(([url]) => url)).toEqual([
      'https://api.workos.com/user_management/redirect_uris',
      'https://api.workos.com/x/one-shot-environments/claim-nonces',
      'https://api.workos.com/user_management/app_homepage_url',
    ]);
    expect(request).toHaveBeenCalledWith(
      'https://api.workos.com/user_management/app_homepage_url',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer sk_test_unclaimed' }),
        body: JSON.stringify({ url: 'http://localhost:4000' }),
      }),
    );
    expect(result.callbackRegistered).toBe(true);
    expect(result.verified).toBe(false);
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['claimed externally', () => Response.json({ already_claimed: true })],
    ['claim conflict', () => new Response(null, { status: 409 })],
    ['invalid claim token', () => new Response(null, { status: 401 })],
    ['missing environment', () => new Response(null, { status: 404 })],
    ['rate limited', () => new Response(null, { status: 429 })],
    ['server error', () => new Response(null, { status: 500 })],
    ['invalid response', () => Response.json({})],
    ['network failure', () => Promise.reject(new Error('private details'))],
    ['timeout', () => Promise.reject(new DOMException('private details', 'AbortError'))],
  ] as const)('preserves the API-only homepage when live claim status reports %s', async (_, claim) => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    vi.mocked(getActiveEnvironment).mockReturnValue({
      name: 'Unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_unclaimed',
      clientId: setup.clientId,
      claimToken: 'claim',
    });
    const request = vi.fn(async (url: string) => (url.endsWith('/claim-nonces') ? claim() : Response.json({})));
    vi.stubGlobal('fetch', request);

    const result = await configureAuthkitApplication(setup, setup.clientId, 'sk_test_unclaimed');

    expect(request.mock.calls.some(([url]) => url.endsWith('/app_homepage_url'))).toBe(false);
    expect(result.callbackRegistered).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('Homepage URL was left unchanged');
    expect(result.reason).not.toContain('private details');

    request.mockClear();
    await configureAuthkitApplication(
      { ...setup, homepageUrl: 'https://requested.example/' },
      setup.clientId,
      'sk_test_unclaimed',
    );
    expect(request.mock.calls.some(([url]) => url.endsWith('/claim-nonces'))).toBe(false);
    expect(request).toHaveBeenCalledWith(
      'https://api.workos.com/user_management/app_homepage_url',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ url: 'https://requested.example/' }) }),
    );
  });

  it.each(['unknown', 'claimed', 'different-unclaimed', 'different-client', 'unavailable'])(
    'skips the unknown API-only homepage for a %s key unless explicitly overridden',
    async (kind) => {
      vi.mocked(refreshIfExpired).mockResolvedValue(null);
      if (kind === 'claimed')
        vi.mocked(getActiveEnvironment).mockReturnValue({
          name: 'Sandbox',
          type: 'sandbox',
          apiKey: 'sk_test_unclaimed',
        });
      if (kind === 'different-unclaimed')
        vi.mocked(getActiveEnvironment).mockReturnValue({
          name: 'Unclaimed',
          type: 'unclaimed',
          apiKey: 'sk_test_other',
          clientId: setup.clientId,
          claimToken: 'claim',
        });
      if (kind === 'different-client')
        vi.mocked(getActiveEnvironment).mockReturnValue({
          name: 'Unclaimed',
          type: 'unclaimed',
          apiKey: 'sk_test_unclaimed',
          clientId: 'client_other',
          claimToken: 'claim',
        });
      if (kind === 'unavailable')
        vi.mocked(getActiveEnvironment).mockImplementation(() => {
          throw new Error('keyring unavailable');
        });
      const request = vi.fn(async (_url: string, init: RequestInit) =>
        init.method === 'GET' ? new Response(null, { status: 404 }) : Response.json({}),
      );
      vi.stubGlobal('fetch', request);
      const result = await configureAuthkitApplication(setup, setup.clientId, 'sk_test_unclaimed');
      expect(result).toMatchObject({ callbackRegistered: true, verified: false });
      expect(result.reason).toContain('Homepage URL was left unchanged');
      expect(result.reason).not.toContain('homepage setup failed');
      expect(request).toHaveBeenCalledTimes(1); // Callback POST only: no homepage GET or PUT.
      request.mockClear();
      await configureAuthkitApplication(
        { ...setup, homepageUrl: 'https://requested.example/' },
        setup.clientId,
        'sk_test_unclaimed',
      );
      expect(request).toHaveBeenCalledWith(
        'https://api.workos.com/user_management/app_homepage_url',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ url: 'https://requested.example/' }) }),
      );
      expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
    },
  );

  it.each(['http', 'network'])(
    'reports API-only homepage %s failures without losing the callback or switching targets',
    async (failure) => {
      vi.mocked(refreshIfExpired).mockResolvedValue(null);
      const request = vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === 'POST') return Response.json({});
        if (init.method === 'GET') return new Response(null, { status: 404 });
        if (failure === 'network') throw new Error('private details');
        return Response.json({ message: 'private details' }, { status: 403 });
      });
      vi.stubGlobal('fetch', request);
      const result = await configureAuthkitApplication(
        { ...setup, homepageUrl: 'https://requested.example/' },
        setup.clientId,
        'sk_test_unclaimed',
      );
      expect(result.callbackRegistered).toBe(true);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('homepage setup failed');
      expect(result.reason).not.toContain('private details');
      expect(request.mock.calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(1);
      expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
    },
  );

  it('does not overwrite a homepage filled concurrently during dashboard setup', async () => {
    delete application.appHomepageUrl;
    application.logoutUris = [{ uri: setup.signOutUri, isDefault: true }];
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      const result = await original(name, options);
      if (name === 'defaultAuthkitApplication') application.appHomepageUrl = 'https://concurrent.example/';
      return result;
    });
    const result = await configureAuthkitApplication(setup, setup.clientId);
    expect(result.reason).toContain('homepage URL changed');
    expect(application.appHomepageUrl).toBe('https://concurrent.example/');
    expect(writes()).toHaveLength(0);
  });

  it('omits a homepage already satisfied at recheck from an initiate-login update', async () => {
    delete application.appHomepageUrl;
    application.logoutUris = [{ uri: setup.signOutUri, isDefault: true }];
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      if (name === 'updateAuthkitApplication') {
        // A dashboard edit lands after the final read but before the mutation.
        application.appHomepageUrl = 'https://concurrent.example/';
      }
      const result = await original(name, options);
      if (name === 'defaultAuthkitApplication' && !application.appHomepageUrl) {
        // Another setup supplied our default before the pre-write recheck.
        application.appHomepageUrl = 'http://localhost:4000';
      }
      return result;
    });
    const result = await configureAuthkitApplication(setup, setup.clientId);
    expect(writes()[0][1].variables?.input).toEqual({
      applicationId: 'app_1',
      initiateLoginUri: setup.initiateLoginUri,
    });
    expect(application.appHomepageUrl).toBe('https://concurrent.example/');
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('read-back');
  });

  it('does not verify a homepage write until read-back matches', async () => {
    delete application.appHomepageUrl;
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      const result = await original(name, options);
      if (name === 'updateAuthkitApplication') delete application.appHomepageUrl;
      return result;
    });
    const result = await configureAuthkitApplication(setup, setup.clientId);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('read-back');
  });

  it('leaves the homepage alone unless --homepage-url was explicitly supplied', async () => {
    application.appHomepageUrl = 'https://existing.example/';
    expect((await configureAuthkitApplication(setup, setup.clientId)).verified).toBe(true);
    expect(application.appHomepageUrl).toBe('https://existing.example/');
    const result = await configureAuthkitApplication(
      { ...setup, homepageUrl: 'https://requested.example/' },
      setup.clientId,
    );
    expect(result.verified).toBe(true);
    expect(application.appHomepageUrl).toBe('https://requested.example/');
    expect(application.initiateLoginUri).toBe(setup.initiateLoginUri);
  });

  it('preserves an equivalent existing root URL without adding a duplicate', async () => {
    application.logoutUris = [{ uri: 'http://localhost:4000', isDefault: true }];
    application.initiateLoginUri = setup.initiateLoginUri;
    const result = await configureAuthkitApplication(setup, setup.clientId);
    expect(result.verified).toBe(true);
    expect(result.signOutUri).toBe('http://localhost:4000');
    expect(writes()).toHaveLength(0);
  });

  it('does not write when settings already match', async () => {
    application.logoutUris.push({ uri: setup.signOutUri, isDefault: true });
    application.initiateLoginUri = setup.initiateLoginUri;
    expect((await configureAuthkitApplication(setup, setup.clientId)).verified).toBe(true);
    expect(writes()).toHaveLength(0);
  });

  it.each(['sign-out', 'initiate-login'] as const)('preserves an existing conflicting %s setting', async (setting) => {
    if (setting === 'sign-out') application.logoutUris[0].isDefault = true;
    else application.initiateLoginUri = 'https://old.example/login';
    const result = await configureAuthkitApplication(setup, setup.clientId);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('left unchanged');
    expect(result.callbackRegistered).toBe(true);
    expect(writes()).toHaveLength(1);
  });

  it('registers the callback with the supplied key when the session belongs to another team', async () => {
    vi.mocked(fetchTeamEnvironments).mockResolvedValue([
      { id: 'env_other', name: 'Other team', clientId: 'client_other', sandbox: true },
    ]);
    const request = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ url: null }));
    vi.stubGlobal('fetch', request);
    const result = await configureAuthkitApplication(setup, setup.clientId, 'sk_test_team_a');
    expect(result.callbackRegistered).toBe(true);
    expect(result.verified).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    for (const [, init] of request.mock.calls) {
      expect(init.headers).toMatchObject({ Authorization: 'Bearer sk_test_team_a' });
    }
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
  });

  it.each(['sign-out', 'initiate-login'] as const)(
    'registers the callback despite a conflicting %s setting',
    async (setting) => {
      application.redirectUris = [];
      if (setting === 'sign-out') application.logoutUris[0].isDefault = true;
      else application.initiateLoginUri = 'https://existing.example/sign-in';
      const result = await configureAuthkitApplication(setup, setup.clientId);
      expect(application.redirectUris.some((uri) => uri.uri === setup.redirectUri)).toBe(true);
      expect(result.callbackRegistered).toBe(true);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('left unchanged');
      expect(writes()[0][0]).toBe('setRedirectUris');
      if (setting === 'sign-out') {
        expect(application.logoutUris).toEqual([{ id: 'uri_old', uri: 'https://old.example/', isDefault: true }]);
        expect(application.initiateLoginUri).toBe(setup.initiateLoginUri);
      } else {
        expect(application.initiateLoginUri).toBe('https://existing.example/sign-in');
        expect(application.logoutUris.some((uri) => uri.uri === setup.signOutUri && uri.isDefault)).toBe(true);
      }
    },
  );

  it('fails instead of completing when the dashboard cannot confirm the callback', async () => {
    vi.mocked(dashboardGraphqlRequest).mockRejectedValue(new Error('private backend error'));
    await expect(configureAuthkitApplication(setup, setup.clientId)).rejects.toThrow(/callback/i);
  });

  it('does not use the active profile when the client ID cannot be matched', async () => {
    vi.mocked(fetchTeamEnvironments).mockResolvedValue([
      { id: 'env_other', name: 'Other', clientId: 'client_other', sandbox: true },
    ]);
    await expect(configureAuthkitApplication(setup, setup.clientId)).rejects.toThrow(/Callback/);
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
  });

  it('does not mutate production or a different application', async () => {
    vi.mocked(fetchTeamEnvironments).mockResolvedValue([
      { id: 'env_prod', name: 'Production', clientId: setup.clientId, sandbox: false },
    ]);
    const production = await configureAuthkitApplication(setup, setup.clientId);
    expect(production.verified).toBe(false);
    expect(production.callbackRegistered).toBe(true);
    expect(production.reason).toContain('restricted to sandbox');
    expect(writes()).toHaveLength(0);
    vi.mocked(fetchTeamEnvironments).mockResolvedValue([
      { id: 'env_app', name: 'Sandbox', clientId: setup.clientId, sandbox: true },
    ]);
    application.clientId = 'client_other';
    await expect(configureAuthkitApplication(setup, setup.clientId)).rejects.toThrow(/Callback/);
    expect(writes()).toHaveLength(0);
  });

  it('fails on a missing production callback without making production or API-key writes', async () => {
    vi.mocked(fetchTeamEnvironments).mockResolvedValue([
      { id: 'env_prod', name: 'Production', clientId: setup.clientId, sandbox: false },
    ]);
    application.redirectUris = [];
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await expect(configureAuthkitApplication(setup, setup.clientId, 'sk_test_other')).rejects.toThrow(
      'restricted to sandbox',
    );
    expect(writes()).toHaveLength(0);
    expect(request).not.toHaveBeenCalled();
  });

  it('fails without credentials rather than claiming an unregistered callback works', async () => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    await expect(configureAuthkitApplication(setup, setup.clientId)).rejects.toThrow(
      'No usable dashboard environment or API key',
    );
    expect(fetchTeamEnvironments).not.toHaveBeenCalled();
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
  });

  it('refuses a changed app client ID before accessing the account', async () => {
    await expect(configureAuthkitApplication(setup, 'client_other')).rejects.toThrow('client ID changed');
    expect(refreshIfExpired).not.toHaveBeenCalled();
  });

  it('fails safely when team discovery fails before callback verification', async () => {
    vi.mocked(fetchTeamEnvironments).mockRejectedValue(new Error('private backend details'));
    await expect(configureAuthkitApplication(setup, setup.clientId)).rejects.toThrow(/Callback/);
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
  });

  it('registers a missing callback while retaining an existing callback and its default', async () => {
    application.redirectUris = [{ uri: 'https://old.example/callback', isDefault: true }];
    expect((await configureAuthkitApplication(setup, setup.clientId)).verified).toBe(true);
    expect(application.redirectUris).toEqual([
      { uri: 'https://old.example/callback', isDefault: true },
      { uri: setup.redirectUri, isDefault: false },
    ]);
    expect(writes()).toHaveLength(3);
  });

  it('uses one client-ID-matched environment for callback, sign-out and initiate-login writes', async () => {
    vi.mocked(fetchTeamEnvironments).mockResolvedValue([
      { id: 'env_key', name: 'API key environment', sandbox: true, clientId: 'client_other' },
      { id: 'env_app', name: 'App environment', sandbox: true, clientId: setup.clientId },
    ]);
    application.redirectUris = [];
    const result = await configureAuthkitApplication(setup, setup.clientId);
    expect(result.verified).toBe(true);
    expect(writes().map(([name]) => name)).toEqual([
      'setRedirectUris',
      'setAuthkitApplicationLogoutUris',
      'updateAuthkitApplication',
    ]);
    for (const [, options] of vi.mocked(dashboardGraphqlRequest).mock.calls) {
      expect(options.environmentId).toBe('env_app');
    }
    for (const [name, options] of writes()) {
      expect(options.variables?.input).toMatchObject(
        name === 'setRedirectUris' ? { environmentId: 'env_app' } : { applicationId: 'app_1' },
      );
    }
    const redirectCalls = vi.mocked(dashboardGraphqlRequest).mock.calls.filter(([name]) => name === 'setRedirectUris');
    expect(redirectCalls.map(([, options]) => options.variables?.input)).toEqual([
      { environmentId: 'env_app', redirectUris: [{ uri: setup.redirectUri, isDefault: true }], dryRun: true },
      { environmentId: 'env_app', redirectUris: [{ uri: setup.redirectUri, isDefault: true }], dryRun: false },
    ]);
  });

  it('fails if the callback write reports success but read-back is missing it', async () => {
    application.redirectUris = [];
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      if (name === 'setRedirectUris') return { setRedirectUris: { __typename: 'RedirectUrisSet' } };
      return original(name, options);
    });
    await expect(configureAuthkitApplication(setup, setup.clientId)).rejects.toThrow('Callback read-back');
    expect(writes().map(([name]) => name)).toEqual(['setRedirectUris']);
  });

  it('rejects incomplete application reads rather than overwriting an unknown list', async () => {
    vi.mocked(dashboardGraphqlRequest).mockResolvedValue({
      defaultUserlandApplication: { id: 'app_1', clientId: setup.clientId },
    });
    await expect(configureAuthkitApplication(setup, setup.clientId)).rejects.toThrow(/Callback/);
    expect(writes()).toHaveLength(0);
  });

  it('does not apply any mutation when the sign-out dry run is rejected', async () => {
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      if (name === 'setAuthkitApplicationLogoutUris')
        return { setUserlandApplicationLogoutUris: { __typename: 'InvalidLogoutUriError' } };
      return original(name, options);
    });
    const result = await configureAuthkitApplication(setup, setup.clientId);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('validation failed');
    expect(writes()).toHaveLength(0);
  });

  it('rejects ambiguous environment matches before any request can mutate settings', async () => {
    vi.mocked(fetchTeamEnvironments).mockResolvedValue([
      { id: 'env_one', name: 'Sandbox', clientId: setup.clientId, sandbox: true },
      { id: 'env_two', name: 'Sandbox', clientId: setup.clientId, sandbox: true },
    ]);
    await expect(configureAuthkitApplication(setup, setup.clientId)).rejects.toThrow('Could not uniquely match');
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
  });

  it('detects a concurrent edit between validation and the full-list write', async () => {
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      const result = await original(name, options);
      if (name === 'setAuthkitApplicationLogoutUris')
        application.logoutUris.push({ uri: 'https://concurrent.example/', isDefault: false });
      return result;
    });
    expect((await configureAuthkitApplication(setup, setup.clientId)).reason).toContain('changed during setup');
    expect(writes()).toHaveLength(0);
  });

  it('does not treat a successful mutation response as verified configuration', async () => {
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      const result = await original(name, options);
      if (name === 'updateAuthkitApplication') application.initiateLoginUri = null;
      return result;
    });
    expect((await configureAuthkitApplication(setup, setup.clientId)).reason).toContain('read-back');
  });

  it('reports a partial write as unverified without leaking the underlying error', async () => {
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      if (name === 'updateAuthkitApplication') throw new Error('private backend details');
      return original(name, options);
    });
    const result = await configureAuthkitApplication(setup, setup.clientId);
    expect(result.verified).toBe(false);
    expect(result.reason).not.toContain('private backend details');
    expect(application.logoutUris.some((uri) => uri.uri === setup.signOutUri)).toBe(true);
  });
});

describe('Unauthorized configuration recovery', () => {
  const unauthorized = () => new DashboardGraphqlError('private fake token', 'forbidden', 401);
  const pair = { clientId: setup.clientId, apiKey: 'sk_test_fake_recovered' };
  let directory: string;
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'recovery-app-'));
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    setInteractionMode({ mode: 'human', source: 'flag' });
    setOutputMode('human');
    vi.spyOn(ui, 'select').mockResolvedValue('retry');
    vi.spyOn(ui.log, 'info').mockImplementation(() => {});
    vi.mocked(ensureAuthenticated).mockResolvedValue({
      authenticated: true,
      loginTriggered: false,
      tokenRefreshed: true,
    });
    vi.mocked(getAccessToken).mockReturnValue('fake-refreshed-token');
    vi.mocked(fetchStagingCredentials).mockResolvedValue(pair);
    vi.mocked(validateInstallation).mockResolvedValue({ passed: true, framework: 'nextjs', issues: [], durationMs: 0 });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
    else Reflect.deleteProperty(process.stdin, 'isTTY');
    resetInteractionModeForTests();
    setOutputMode('human');
    await rm(directory, { recursive: true, force: true });
  });

  const contextFor = (installDir: string, integration = 'sveltekit') => ({
    options: {
      installDir,
      debug: false,
      forceInstall: false,
      local: false,
      ci: false,
      skipAuth: true,
      redirectUri: setup.redirectUri,
    },
    integration,
    credentials: { apiKey: 'sk_test_fake_rejected', clientId: setup.clientId },
    emitter: createInstallerEventEmitter(),
  });

  it('recovers the real post-agent Next.js path without changing local credentials or skipping validation/read-back', async () => {
    const context = contextFor(directory, 'nextjs');
    await writeFile(
      join(directory, '.env.local'),
      `WORKOS_API_KEY=${context.credentials.apiKey}\nWORKOS_CLIENT_ID=${setup.clientId}\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=${setup.redirectUri}\n`,
    );
    vi.mocked(fetchTeamEnvironments).mockRejectedValueOnce(unauthorized());
    const result = await configureNextjsApplicationUrls(context);
    expect(result.verified).toBe(true);
    expect(validateInstallation).toHaveBeenCalledWith('nextjs', directory, { runBuild: false });
    expect(ui.select).toHaveBeenCalledTimes(1);
    expect(fetchTeamEnvironments).toHaveBeenLastCalledWith('fake-refreshed-token');
    expect(vi.mocked(dashboardGraphqlRequest).mock.calls.at(-1)?.[0]).toBe('defaultAuthkitApplication');
    expect(context.credentials.apiKey).toBe('sk_test_fake_rejected');
    expect(fetchStagingCredentials).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(['nextjs', 'sveltekit'])(
    'adopts an authoritative pair in %s but leaves the unclaimed profile homepage explicitly incomplete',
    async (integration) => {
      const context = contextFor(directory, integration);
      vi.mocked(getActiveEnvironment).mockReturnValue({
        name: 'fake-unclaimed',
        type: 'unclaimed',
        ...context.credentials,
        claimToken: 'fake_claim_token',
      });
      const redirectKey = integration === 'nextjs' ? 'NEXT_PUBLIC_WORKOS_REDIRECT_URI' : 'WORKOS_REDIRECT_URI';
      await writeFile(
        join(directory, '.env.local'),
        `# keep\nWORKOS_API_KEY=${context.credentials.apiKey}\nWORKOS_CLIENT_ID=${setup.clientId}\n${redirectKey}=${setup.redirectUri}\n`,
      );
      vi.mocked(refreshIfExpired).mockResolvedValue(null);
      const request = vi.fn(async (_url: string, init: RequestInit) =>
        Response.json(
          {},
          {
            status: (init.headers as Record<string, string>).Authorization.includes('fake_rejected') ? 401 : 201,
          },
        ),
      );
      vi.stubGlobal('fetch', request);
      const result =
        integration === 'nextjs'
          ? await configureNextjsApplicationUrls(context)
          : await configureOtherApplicationUrls(context, setup.clientId, context.credentials.apiKey);
      expect(result).toMatchObject({ callbackRegistered: true, verified: false });
      expect(result?.reason).toContain('Homepage URL was left unchanged');
      expect(context.credentials).toEqual(pair);
      expect(context.options).toMatchObject(pair);
      const env = await readFile(join(directory, '.env.local'), 'utf8');
      expect(env).toContain(`WORKOS_API_KEY=${pair.apiKey}`);
      expect(env).toContain(`WORKOS_CLIENT_ID=${pair.clientId}`);
      expect(env).toContain('# keep');
      expect(env).not.toContain('fake_rejected');
      expect(JSON.stringify(result)).not.toContain(pair.apiKey);
      expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
      expect(fetchTeamEnvironments).not.toHaveBeenCalled();
      expect(vi.mocked(getActiveEnvironment).mock.results.at(-1)?.value.apiKey).toBe('sk_test_fake_rejected');
      expect(
        request.mock.calls.every(([url]) => !url.endsWith('/app_homepage_url') && !url.endsWith('/claim-nonces')),
      ).toBe(true);
    },
  );

  it.each(['same', 'mismatch', 'production', 'repeated401', 'cancel', 'manual', 'authFailure'])(
    'leaves state and files unchanged when REST recovery fails: %s',
    async (failure) => {
      const context = contextFor(directory);
      const before = `WORKOS_API_KEY=${context.credentials.apiKey}\nWORKOS_CLIENT_ID=${setup.clientId}\n`;
      await writeFile(join(directory, '.env.local'), before);
      vi.mocked(refreshIfExpired).mockResolvedValue(null);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ message: 'fake_private_key' }, { status: 401 })),
      );
      if (failure === 'same')
        vi.mocked(fetchStagingCredentials).mockResolvedValue({ ...pair, apiKey: context.credentials.apiKey });
      if (failure === 'mismatch')
        vi.mocked(fetchStagingCredentials).mockResolvedValue({ ...pair, clientId: 'client_other' });
      if (failure === 'production')
        vi.mocked(fetchStagingCredentials).mockResolvedValue({ ...pair, apiKey: 'sk_live_fake' });
      if (failure === 'cancel') vi.mocked(ui.select).mockResolvedValue(CANCEL);
      if (failure === 'manual') vi.mocked(ui.select).mockResolvedValue('manual');
      if (failure === 'authFailure') vi.mocked(ensureAuthenticated).mockRejectedValue(new Error('fake_private_key'));
      await expect(
        configureOtherApplicationUrls(context, setup.clientId, context.credentials.apiKey),
      ).rejects.toMatchObject({
        code: failure === 'cancel' ? 'cancelled' : 'auth_required',
        message: expect.not.stringContaining('fake_private_key'),
      });
      expect(ui.select).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledTimes(failure === 'repeated401' ? 2 : 1);
      expect(context.credentials.apiKey).toBe('sk_test_fake_rejected');
      expect(context.options).not.toHaveProperty('apiKey');
      expect(await readFile(join(directory, '.env.local'), 'utf8')).toBe(before);
    },
  );

  it.each(['failed', 'cancelled', 'not-authenticated'])(
    'leaves post-agent files and target untouched when dashboard auth checking is %s',
    async (outcome) => {
      const context = contextFor(directory, 'nextjs');
      const before = `WORKOS_API_KEY=${context.credentials.apiKey}\nWORKOS_CLIENT_ID=${setup.clientId}\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=${setup.redirectUri}\n`;
      await writeFile(join(directory, '.env.local'), before);
      vi.mocked(fetchTeamEnvironments).mockRejectedValueOnce(unauthorized());
      if (outcome === 'not-authenticated')
        vi.mocked(ensureAuthenticated).mockResolvedValue({
          authenticated: false,
          loginTriggered: true,
          tokenRefreshed: false,
        });
      else
        vi.mocked(ensureAuthenticated).mockRejectedValue(
          outcome === 'cancelled' ? new CliExit(2) : new Error('fake_private_auth_error'),
        );
      await expect(configureNextjsApplicationUrls(context)).rejects.toMatchObject({
        code: outcome === 'cancelled' ? 'cancelled' : 'auth_required',
        message: expect.not.stringContaining('fake_private_auth_error'),
      });
      expect(await readFile(join(directory, '.env.local'), 'utf8')).toBe(before);
      expect(context.credentials.apiKey).toBe('sk_test_fake_rejected');
      expect(fetchTeamEnvironments).toHaveBeenCalledTimes(1);
      expect(ui.select).toHaveBeenCalledTimes(1);
      expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['prompt', () => vi.mocked(ui.select).mockResolvedValue(CANCEL)],
    ['login', () => vi.mocked(ensureAuthenticated).mockRejectedValue(new CliExit(2))],
  ] as const)('cancels instead of completing when %s cancellation follows callback registration', async (_, cancel) => {
    cancel();
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      if (name === 'updateAuthkitApplication') throw unauthorized();
      return original(name, options);
    });
    await expect(configureAuthkitApplication(setup, setup.clientId, 'sk_test_fake')).rejects.toMatchObject({
      code: 'cancelled',
      message: expect.stringContaining('callback URL was registered'),
    });
    expect(application.redirectUris.some((uri) => uri.uri === setup.redirectUri)).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps an explicit manual choice after callback registration as an unverified partial result', async () => {
    vi.mocked(ui.select).mockResolvedValue('manual');
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      if (name === 'updateAuthkitApplication') throw unauthorized();
      return original(name, options);
    });
    expect(await configureAuthkitApplication(setup, setup.clientId, 'sk_test_fake')).toMatchObject({
      callbackRegistered: true,
      verified: false,
      reason: expect.stringContaining('declined'),
    });
    expect(ensureAuthenticated).not.toHaveBeenCalled();
  });

  it.each([
    ['another team', [{ id: 'env_other', name: 'Other', clientId: 'client_other', sandbox: true }]],
    ['no environments', []],
  ])(
    'falls back to the sandbox API key when the refreshed session sees %s and no dashboard target was used',
    async (_, environments) => {
      vi.mocked(fetchTeamEnvironments).mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce(environments);
      const request = vi.fn(async (_url: string, _init: RequestInit) => Response.json({}, { status: 201 }));
      vi.stubGlobal('fetch', request);
      const result = await configureAuthkitApplication(setup, setup.clientId, 'sk_test_fake_app');
      expect(result).toMatchObject({ callbackRegistered: true, verified: false });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer sk_test_fake_app' });
      expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
      expect(fetchTeamEnvironments).toHaveBeenCalledTimes(2);
      expect(ui.select).toHaveBeenCalledTimes(1);
    },
  );

  it('bounds the post-retry API-key fallback: a 401 there is not offered recovery again', async () => {
    vi.mocked(fetchTeamEnvironments).mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({}, { status: 401 })),
    );
    await expect(configureAuthkitApplication(setup, setup.clientId, 'sk_test_fake_app')).rejects.toMatchObject({
      code: 'auth_required',
      message: expect.stringContaining('exhausted after one retry'),
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(ui.select).toHaveBeenCalledTimes(1);
  });

  it('preserves cancellation during the authentication check', async () => {
    vi.mocked(fetchTeamEnvironments).mockRejectedValue(unauthorized());
    vi.mocked(ensureAuthenticated).mockRejectedValue(new CliExit(2));
    await expect(configureAuthkitApplication(setup, setup.clientId)).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchTeamEnvironments).toHaveBeenCalledTimes(1);
  });

  it('fails without adopting a key revoked between callback and CORS on the retry', async () => {
    const context = contextFor(directory);
    const before = `WORKOS_API_KEY=${context.credentials.apiKey}\nWORKOS_CLIENT_ID=${setup.clientId}\n`;
    await writeFile(join(directory, '.env.local'), before);
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({}, { status: 401 }))
        .mockResolvedValueOnce(Response.json({}, { status: 201 }))
        .mockResolvedValueOnce(Response.json({}, { status: 401 })),
    );
    await expect(
      configureOtherApplicationUrls(context, setup.clientId, context.credentials.apiKey),
    ).rejects.toMatchObject({
      code: 'auth_required',
      message: expect.stringContaining('replacement API key was rejected'),
    });
    expect(await readFile(join(directory, '.env.local'), 'utf8')).toBe(before);
    expect(context.credentials.apiKey).toBe('sk_test_fake_rejected');
    expect(ui.select).toHaveBeenCalledTimes(1);
  });

  it('does not adopt a pair when the agent changed the local credential file', async () => {
    const context = contextFor(directory);
    const before = 'WORKOS_API_KEY=sk_test_fake_other\nWORKOS_CLIENT_ID=client_other\n';
    await writeFile(join(directory, '.env.local'), before);
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({}, { status: 401 }))
        .mockImplementation(async () => Response.json({})),
    );
    await expect(
      configureOtherApplicationUrls(context, setup.clientId, context.credentials.apiKey),
    ).rejects.toMatchObject({ code: 'credential_recovery_failed' });
    expect(await readFile(join(directory, '.env.local'), 'utf8')).toBe(before);
    expect(context.credentials.apiKey).toBe('sk_test_fake_rejected');
  });

  it.each(['ruby', 'go', 'dotnet'])('does not guess how to rewrite %s post-agent credentials', async (integration) => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({}, { status: 401 })),
    );
    const context = contextFor(directory, integration);
    await expect(configureOtherApplicationUrls(context, setup.clientId, context.credentials.apiKey)).rejects.toThrow(
      'replacement is unavailable',
    );
    expect(ui.select).not.toHaveBeenCalled();
    expect(ensureAuthenticated).not.toHaveBeenCalled();
  });

  it.each(['agent', 'ci', 'json', 'non-tty'])('does not prompt or invoke auth for %s mode', async (mode) => {
    if (mode === 'json') setOutputMode('json');
    else if (mode === 'non-tty') Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    else setInteractionMode({ mode: mode as 'agent' | 'ci', source: 'flag' });
    vi.mocked(fetchTeamEnvironments).mockRejectedValue(unauthorized());
    await expect(configureAuthkitApplication(setup, setup.clientId)).rejects.toMatchObject({
      code: 'auth_required',
      message: expect.stringContaining('Interactive recovery is unavailable'),
    });
    expect(ui.select).not.toHaveBeenCalled();
    expect(ensureAuthenticated).not.toHaveBeenCalled();
  });

  it('uses the shared TUI prompt host for recovery', async () => {
    vi.mocked(ui.select).mockRestore();
    const prompt = vi.fn(async () => 'retry');
    setUiHost({ prompt, line: vi.fn(), status: vi.fn() });
    try {
      vi.mocked(fetchTeamEnvironments).mockRejectedValueOnce(unauthorized());
      expect((await configureAuthkitApplication(setup, setup.clientId)).verified).toBe(true);
      expect(prompt).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'select', message: expect.stringContaining('Unauthorized') }),
      );
    } finally {
      setUiHost(null);
    }
  });

  it('bounds repeated dashboard Unauthorized and reports partial configuration honestly', async () => {
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      if (name === 'updateAuthkitApplication') throw unauthorized();
      return original(name, options);
    });
    const result = await configureAuthkitApplication(setup, setup.clientId, 'sk_test_fake');
    expect(result).toMatchObject({
      callbackRegistered: true,
      verified: false,
      reason: expect.stringContaining('exhausted after one retry'),
    });
    expect(ui.select).toHaveBeenCalledTimes(1);
    expect(ensureAuthenticated).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('honors explicit --ci even when the interaction mode is human and stdin is a TTY', async () => {
    const context = contextFor(directory);
    context.options.ci = true;
    vi.mocked(fetchTeamEnvironments).mockRejectedValue(unauthorized());
    await expect(
      configureOtherApplicationUrls(context, setup.clientId, context.credentials.apiKey),
    ).rejects.toMatchObject({ code: 'auth_required' });
    expect(ui.select).not.toHaveBeenCalled();
    expect(ensureAuthenticated).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps unchanged-session recovery manual, with callbackRegistered=%s',
    async (callbackRegistered) => {
      vi.mocked(getAccessToken).mockReturnValue('test-token');
      vi.mocked(ensureAuthenticated).mockResolvedValue({
        authenticated: true,
        loginTriggered: false,
        tokenRefreshed: false,
      });
      if (callbackRegistered) {
        const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
        vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
          if (name === 'updateAuthkitApplication') throw unauthorized();
          return original(name, options);
        });
      } else vi.mocked(fetchTeamEnvironments).mockRejectedValue(unauthorized());
      const outcome = configureAuthkitApplication(setup, setup.clientId);
      if (callbackRegistered) {
        expect(await outcome).toMatchObject({
          callbackRegistered: true,
          verified: false,
          reason: expect.stringContaining('auth login` alone may reuse'),
        });
      } else {
        await expect(outcome).rejects.toMatchObject({
          code: 'auth_required',
          message: expect.stringContaining('auth login` alone may reuse'),
        });
      }
      expect(fetchTeamEnvironments).toHaveBeenCalledTimes(1);
      expect(ui.select).toHaveBeenCalledTimes(1);
      expect(ui.log.info).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['forbidden', 'network', 'message401'])('does not recover non-auth failures (%s)', async (failure) => {
    vi.mocked(fetchTeamEnvironments).mockRejectedValue(
      failure === 'forbidden'
        ? new DashboardGraphqlError('forbidden', 'forbidden', 403)
        : new Error(failure === 'network' ? 'network failed' : 'Unauthorized HTTP 401'),
    );
    await expect(configureAuthkitApplication(setup, setup.clientId)).rejects.toThrow('Callback');
    expect(ui.select).not.toHaveBeenCalled();
  });

  it('reconciles partial writes on the same target, without replaying logout or falling back to REST', async () => {
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    let rejected = false;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      if (name === 'updateAuthkitApplication' && !rejected) {
        rejected = true;
        throw unauthorized();
      }
      return original(name, options);
    });
    const result = await configureAuthkitApplication(setup, setup.clientId, 'sk_test_fake');
    expect(result.verified).toBe(true);
    expect(writes().filter(([name]) => name === 'setAuthkitApplicationLogoutUris')).toHaveLength(1);
    expect(application.appHomepageUrl).toBe('https://existing.example/');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(fetchTeamEnvironments).toHaveBeenCalledTimes(2);
    expect(ui.select).toHaveBeenCalledTimes(1);
  });

  it('re-reads a callback write whose response was Unauthorized, rather than replaying the stale list', async () => {
    application.redirectUris = [{ uri: 'https://old.example/callback', isDefault: true }];
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    let rejected = false;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      const result = await original(name, options);
      if (name === 'setRedirectUris' && !(options.variables!.input as { dryRun: boolean }).dryRun && !rejected) {
        rejected = true;
        application.redirectUris.push({ uri: 'https://concurrent.example/callback', isDefault: false });
        throw unauthorized();
      }
      return result;
    });
    expect((await configureAuthkitApplication(setup, setup.clientId, 'sk_test_fake')).verified).toBe(true);
    expect(writes().filter(([name]) => name === 'setRedirectUris')).toHaveLength(1);
    expect(application.redirectUris).toEqual([
      { uri: 'https://old.example/callback', isDefault: true },
      { uri: setup.redirectUri, isDefault: false },
      { uri: 'https://concurrent.example/callback', isDefault: false },
    ]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(['missing', 'ambiguous', 'environment', 'application', 'production'])(
    'rejects a changed recovery target (%s) after a partial write',
    async (change) => {
      const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
      vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
        if (name === 'updateAuthkitApplication') {
          if (change === 'application') application.id = 'app_other';
          else
            vi.mocked(fetchTeamEnvironments).mockResolvedValue(
              change === 'missing'
                ? []
                : change === 'ambiguous'
                  ? [
                      { id: 'env_app', name: 'A', clientId: setup.clientId, sandbox: true },
                      { id: 'env_other', name: 'B', clientId: setup.clientId, sandbox: true },
                    ]
                  : [
                      {
                        id: change === 'environment' ? 'env_other' : 'env_app',
                        name: 'Changed',
                        clientId: setup.clientId,
                        sandbox: change !== 'production',
                      },
                    ],
            );
          throw unauthorized();
        }
        return original(name, options);
      });
      const outcome = configureAuthkitApplication(setup, setup.clientId, 'sk_test_fake');
      if (change === 'production')
        expect(await outcome).toMatchObject({ verified: false, reason: expect.stringContaining('sandbox') });
      else await expect(outcome).rejects.toThrow('Callback');
      expect(ui.select).toHaveBeenCalledTimes(1);
      expect(writes().filter(([name]) => name === 'setAuthkitApplicationLogoutUris')).toHaveLength(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it('requires final read-back even after successful recovery', async () => {
    vi.mocked(fetchTeamEnvironments).mockRejectedValueOnce(unauthorized());
    const original = vi.mocked(dashboardGraphqlRequest).getMockImplementation()!;
    vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
      const result = await original(name, options);
      if (name === 'updateAuthkitApplication') application.redirectUris = [];
      return result;
    });
    await expect(configureAuthkitApplication(setup, setup.clientId)).rejects.toThrow('Callback read-back');
    expect(ui.select).toHaveBeenCalledTimes(1);
  });
});

describe('app URL derivation', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'authkit-urls-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('uses the actual callback origin and custom port while keeping the two routes distinct', async () => {
    await writeFile(
      join(directory, '.env.local'),
      'WORKOS_CLIENT_ID=client_app\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:4567/auth/callback\n',
    );
    const result = await readNextjsApplicationSetup(directory);
    expect(result.initiateLoginUri).toBe('http://localhost:4567/sign-in');
    expect(result.signOutUri).toBe('http://localhost:4567/');
    expect(result.redirectUri).toBe('http://localhost:4567/auth/callback');
    expect(result.verified).toBe(false);
  });

  it('rejects using the same path for sign-in and callback', async () => {
    await writeFile(
      join(directory, '.env.local'),
      'WORKOS_CLIENT_ID=client_app\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/sign-in\n',
    );
    await expect(readNextjsApplicationSetup(directory)).rejects.toThrow('cannot use /sign-in');
  });

  it("builds a framework's initiate login URI from its own sign-in path", () => {
    const result = buildApplicationSetup({
      clientId: 'client_app',
      redirectUri: 'http://localhost:8080/auth/callback',
      signInPath: '/auth/login',
    });
    expect(result.initiateLoginUri).toBe('http://localhost:8080/auth/login');
    expect(result.signOutUri).toBe('http://localhost:8080/');
  });

  it('omits the initiate login URI when the framework has no fixed sign-in path', () => {
    const result = buildApplicationSetup({
      clientId: 'client_app',
      redirectUri: 'http://localhost:3000/auth/callback',
    });
    expect(result).not.toHaveProperty('initiateLoginUri');
    expect(result.signOutUri).toBe('http://localhost:3000/');
  });
});
