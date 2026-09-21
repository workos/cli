import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('./command-auth.js', () => ({ refreshIfExpired: vi.fn() }));
vi.mock('./environment-target.js', () => ({ fetchTeamEnvironments: vi.fn(), resolveEnvironmentTarget: vi.fn() }));
vi.mock('./dashboard-graphql.js', () => ({ dashboardGraphqlRequest: vi.fn() }));
vi.mock('../catalog/operation.js', () => ({
  getOperation: (name: string) => ({ name }),
  resolveExecutableDocument: (operation: { name: string }) => operation.name,
}));

import { refreshIfExpired } from './command-auth.js';
import { fetchTeamEnvironments, resolveEnvironmentTarget } from './environment-target.js';
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
  vi.mocked(resolveEnvironmentTarget).mockResolvedValue({ environmentId: 'env_app', source: 'flag' });
  application = {
    id: 'app_1',
    clientId: setup.clientId,
    redirectUris: [{ uri: setup.redirectUri, isDefault: true }],
    logoutUris: [{ id: 'uri_old', uri: 'https://old.example/', isDefault: false }],
    initiateLoginUri: null,
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

describe('native application URL setup', () => {
  it('validates, preserves existing URLs, writes to the matched application, and reads back', async () => {
    const result = await configureAuthkitApplication(setup, setup.clientId);
    expect(result.verified).toBe(true);
    expect(application.logoutUris).toContainEqual({ id: 'uri_old', uri: 'https://old.example/', isDefault: false });
    expect(application.logoutUris).toContainEqual({ uri: setup.signOutUri, isDefault: true });
    expect(application.initiateLoginUri).toBe(setup.initiateLoginUri);
    expect(resolveEnvironmentTarget).toHaveBeenCalledWith('test-token', { flagValue: 'env_app', forMutation: true });
    for (const [, options] of vi.mocked(dashboardGraphqlRequest).mock.calls)
      expect(options.environmentId).toBe('env_app');
    expect(vi.mocked(dashboardGraphqlRequest).mock.calls.at(-1)?.[0]).toBe('defaultAuthkitApplication');
    expect(writes()).toHaveLength(2);
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
    expect(writes()).toHaveLength(0);
  });

  it('does not use the active profile when the client ID cannot be matched', async () => {
    vi.mocked(fetchTeamEnvironments).mockResolvedValue([
      { id: 'env_other', name: 'Other', clientId: 'client_other', sandbox: true },
    ]);
    expect((await configureAuthkitApplication(setup, setup.clientId)).verified).toBe(false);
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
  });

  it('does not mutate production or a different application', async () => {
    vi.mocked(fetchTeamEnvironments).mockResolvedValue([
      { id: 'env_prod', name: 'Production', clientId: setup.clientId, sandbox: false },
    ]);
    expect((await configureAuthkitApplication(setup, setup.clientId)).verified).toBe(false);
    expect(dashboardGraphqlRequest).not.toHaveBeenCalled();
    vi.mocked(fetchTeamEnvironments).mockResolvedValue([
      { id: 'env_app', name: 'Sandbox', clientId: setup.clientId, sandbox: true },
    ]);
    application.clientId = 'client_other';
    expect((await configureAuthkitApplication(setup, setup.clientId)).verified).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it('reports missing dashboard access without launching authentication or attempting a write', async () => {
    vi.mocked(refreshIfExpired).mockResolvedValue(null);
    const result = await configureAuthkitApplication(setup, setup.clientId);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('No dashboard session');
    expect(fetchTeamEnvironments).not.toHaveBeenCalled();
    expect(applicationSetupNextSteps(result).join('\n')).toContain(setup.initiateLoginUri);
  });

  it('refuses a changed app client ID before accessing the account', async () => {
    expect((await configureAuthkitApplication(setup, 'client_other')).verified).toBe(false);
    expect(refreshIfExpired).not.toHaveBeenCalled();
  });

  it('stops when environment validation fails', async () => {
    vi.mocked(resolveEnvironmentTarget).mockRejectedValue(new Error('environment_stale'));
    expect((await configureAuthkitApplication(setup, setup.clientId)).verified).toBe(false);
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
      'setAuthkitApplicationLogoutUris',
      'updateAuthkitApplication',
      'setRedirectUris',
    ]);
    for (const [, options] of vi.mocked(dashboardGraphqlRequest).mock.calls) {
      expect(options.environmentId).toBe('env_app');
    }
    for (const [, options] of writes()) {
      expect(options.variables?.input).toMatchObject({ applicationId: 'app_1' });
    }
  });

  it('rejects incomplete application reads rather than overwriting an unknown list', async () => {
    vi.mocked(dashboardGraphqlRequest).mockResolvedValue({
      defaultUserlandApplication: { id: 'app_1', clientId: setup.clientId },
    });
    expect((await configureAuthkitApplication(setup, setup.clientId)).verified).toBe(false);
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
    expect((await configureAuthkitApplication(setup, setup.clientId)).verified).toBe(false);
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
