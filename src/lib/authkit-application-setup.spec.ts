import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('./command-auth.js', () => ({ refreshIfExpired: vi.fn() }));
vi.mock('./api-key.js', () => ({
  resolveApiBaseUrl: () => 'https://api.workos.com',
  resolveApiKey: vi.fn(),
}));
vi.mock('./environment-target.js', () => ({ fetchTeamEnvironments: vi.fn() }));
vi.mock('./dashboard-graphql.js', () => ({ dashboardGraphqlRequest: vi.fn() }));
vi.mock('../catalog/operation.js', () => ({
  getOperation: (name: string) => ({ name }),
  resolveExecutableDocument: (operation: { name: string }) => operation.name,
}));

import { refreshIfExpired } from './command-auth.js';
import { fetchTeamEnvironments } from './environment-target.js';
import { dashboardGraphqlRequest } from './dashboard-graphql.js';
import { configureAuthkitApplication, readNextjsApplicationSetup } from './authkit-application-setup.js';
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
  vi.mocked(refreshIfExpired).mockResolvedValue({ accessToken: 'test-token', refreshed: false });
  vi.mocked(fetchTeamEnvironments).mockResolvedValue([
    { id: 'env_app', name: 'Sandbox', sandbox: true, clientId: setup.clientId },
  ]);
  application = {
    id: 'app_1',
    clientId: setup.clientId,
    redirectUris: [{ uri: setup.redirectUri, isDefault: true }],
    logoutUris: [{ id: 'uri_old', uri: 'https://old.example/', isDefault: false }],
    initiateLoginUri: null,
    appHomepageUrl: 'https://existing.example/',
  };
  vi.mocked(dashboardGraphqlRequest).mockImplementation(async (name, options) => {
    if (name === 'defaultAuthkitApplication') return { defaultUserlandApplication: structuredClone(application) };
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
        applicationId: string;
        redirectUris: typeof application.redirectUris;
        dryRun: boolean;
      };
      expect(input.applicationId).toBe('app_1');
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

  it('fills an empty dashboard homepage with the callback origin', async () => {
    delete application.appHomepageUrl;
    expect((await configureAuthkitApplication(setup, setup.clientId)).verified).toBe(true);
    expect(application.appHomepageUrl).toBe('http://localhost:4000');
  });

  it('fills an empty API-only homepage with the callback origin', async () => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    const request = vi.fn(async () => Response.json({ url: null }));
    vi.stubGlobal('fetch', request);
    const result = await configureAuthkitApplication(setup, setup.clientId, 'sk_test_unclaimed');
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

  it('preserves an existing API-only homepage unless explicitly overridden', async () => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    const request = vi.fn(async () => Response.json({ url: 'https://existing.example/' }));
    vi.stubGlobal('fetch', request);
    await configureAuthkitApplication(setup, setup.clientId, 'sk_test_unclaimed');
    expect(request).toHaveBeenCalledTimes(2); // Callback POST and homepage GET, no PUT.
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
  });

  it.each(['http', 'network', 'invalid-json', 'missing-url', 'put'])(
    'reports API-only homepage %s failures without losing the callback or switching targets',
    async (failure) => {
      vi.mocked(refreshIfExpired).mockResolvedValue(null);
      const request = vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === 'POST') return Response.json({});
        if (failure === 'network') throw new Error('private details');
        if (failure === 'invalid-json') return new Response('invalid');
        if (failure === 'missing-url') return Response.json({});
        if (failure === 'put' && init.method === 'GET') return Response.json({ url: null });
        return Response.json({ message: 'private details' }, { status: 403 });
      });
      vi.stubGlobal('fetch', request);
      const result = await configureAuthkitApplication(setup, setup.clientId, 'sk_test_unclaimed');
      expect(result.callbackRegistered).toBe(true);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('homepage setup failed');
      expect(result.reason).not.toContain('private details');
      expect(request.mock.calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(failure === 'put' ? 1 : 0);
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
    expect(request).toHaveBeenCalledTimes(3);
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
    for (const [, options] of writes()) {
      expect(options.variables?.input).toMatchObject({ applicationId: 'app_1' });
    }
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
});
