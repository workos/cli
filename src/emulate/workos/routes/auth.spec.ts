import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';
import { getWorkOSStore } from '../store.js';
import type { Store } from '../../core/index.js';

const apiKeys: ApiKeyMap = { sk_test_auth: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_auth', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Auth routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let store: Store;

  beforeEach(() => {
    const server = createTestApp();
    app = server.app;
    store = server.store;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  async function createUser(
    email: string,
    opts?: { password?: string; impersonator?: { email: string; reason: string } },
  ) {
    const ws = getWorkOSStore(store);
    return ws.users.insert({
      object: 'user',
      email,
      first_name: null,
      last_name: null,
      email_verified: false,
      profile_picture_url: null,
      last_sign_in_at: null,
      external_id: null,
      metadata: {},
      locale: null,
      password_hash: null,
      impersonator: opts?.impersonator ?? null,
    });
  }

  it('authorize redirects with code when user exists', async () => {
    await req('/user_management/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'auth@test.com' }),
    });

    const res = await app.request(
      '/user_management/authorize?redirect_uri=http://localhost:3000/callback&response_type=code&state=mystate',
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    const url = new URL(location);
    expect(url.searchParams.get('code')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe('mystate');
  });

  it('authenticate with password grant', async () => {
    await req('/user_management/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'pass@test.com', password: 'secret' }),
    });

    const res = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        email: 'pass@test.com',
        password: 'secret',
      }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.access_token).toBeDefined();
    expect(body.user.email).toBe('pass@test.com');
    expect(body.authentication_method).toBe('Password');
  });

  it('rejects invalid password', async () => {
    await req('/user_management/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'bad@test.com', password: 'correct' }),
    });

    const res = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        email: 'bad@test.com',
        password: 'wrong',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('authorization_code grant flow', async () => {
    await req('/user_management/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'code@test.com' }),
    });

    const authRes = await app.request(
      '/user_management/authorize?redirect_uri=http://localhost:3000/callback&response_type=code',
    );
    const location = authRes.headers.get('location')!;
    const code = new URL(location).searchParams.get('code')!;

    const tokenRes = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const body = await json(tokenRes);
    expect(body.access_token).toBeDefined();
    expect(body.authentication_method).toBe('OAuth');
  });

  it('authorize rejects non-localhost redirect_uri', async () => {
    const res = await app.request(
      '/user_management/authorize?redirect_uri=https://evil.example.com/callback&response_type=code',
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe('invalid_redirect_uri');
  });

  it('authorize allows 127.0.0.1 redirect_uri', async () => {
    await req('/user_management/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'ip@test.com' }),
    });

    const res = await app.request(
      '/user_management/authorize?redirect_uri=http://127.0.0.1:5000/callback&response_type=code',
    );
    expect(res.status).toBe(302);
  });

  // --- login_hint tests ---

  it('authorize with login_hint selects correct user', async () => {
    await createUser('first@test.com');
    await createUser('second@test.com');

    const res = await app.request(
      '/user_management/authorize?redirect_uri=http://localhost:3000/callback&login_hint=second@test.com',
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    const code = new URL(location).searchParams.get('code')!;

    // Exchange code and verify the correct user
    const tokenRes = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code }),
    });
    const body = await json(tokenRes);
    expect(body.user.email).toBe('second@test.com');
  });

  it('authorize with unknown login_hint redirects with error', async () => {
    await createUser('exists@test.com');

    const res = await app.request(
      '/user_management/authorize?redirect_uri=http://localhost:3000/callback&login_hint=nope@test.com&state=s1',
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    const url = new URL(location);
    expect(url.searchParams.get('error')).toBe('user_not_found');
    expect(url.searchParams.get('state')).toBe('s1');
  });

  // --- Refresh token tests ---

  it('refresh_token grant returns new tokens and invalidates old', async () => {
    await req('/user_management/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'refresh@test.com', password: 'pw' }),
    });

    // Authenticate to get a refresh token
    const authRes = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'password', email: 'refresh@test.com', password: 'pw' }),
    });
    const authBody = await json(authRes);
    const oldRefresh = authBody.refresh_token;
    expect(oldRefresh).toBeDefined();

    // Use refresh token
    const refreshRes = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: oldRefresh }),
    });
    expect(refreshRes.status).toBe(200);
    const refreshBody = await json(refreshRes);
    expect(refreshBody.access_token).toBeDefined();
    expect(refreshBody.refresh_token).toBeDefined();
    expect(refreshBody.refresh_token).not.toBe(oldRefresh);

    // Old refresh token should be invalidated (rotation)
    const retryRes = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: oldRefresh }),
    });
    expect(retryRes.status).toBe(400);
    const retryBody = await json(retryRes);
    expect(retryBody.code).toBe('invalid_grant');
  });

  it('rejects invalid refresh token', async () => {
    const res = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'bogus_token' }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe('invalid_grant');
  });

  // --- Impersonation tests ---

  it('includes impersonator in response when configured', async () => {
    await createUser('target@test.com', {
      impersonator: { email: 'admin@test.com', reason: 'debugging' },
    });

    // Authorize + authenticate to get the response
    const authRes = await app.request('/user_management/authorize?redirect_uri=http://localhost:3000/callback');
    const code = new URL(authRes.headers.get('location')!).searchParams.get('code')!;
    const tokenRes = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code }),
    });
    const body = await json(tokenRes);
    expect(body.impersonator).toEqual({ email: 'admin@test.com', reason: 'debugging' });
  });

  it('omits impersonator when not configured', async () => {
    await createUser('normal@test.com');

    const authRes = await app.request('/user_management/authorize?redirect_uri=http://localhost:3000/callback');
    const code = new URL(authRes.headers.get('location')!).searchParams.get('code')!;
    const tokenRes = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code }),
    });
    const body = await json(tokenRes);
    expect(body.impersonator).toBeUndefined();
  });

  // --- Sealed session tests ---

  it('returns sealed_session when client_secret provided', async () => {
    await req('/user_management/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'sealed@test.com', password: 'pw' }),
    });

    const res = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        email: 'sealed@test.com',
        password: 'pw',
        client_secret: 'sk_test_secret',
      }),
    });
    const body = await json(res);
    expect(body.sealed_session).toBeTruthy();
    expect(typeof body.sealed_session).toBe('string');
  });

  // --- Grant type alias tests ---

  it('accepts new magic-auth:code grant type alias', async () => {
    await req('/user_management/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'magic@test.com' }),
    });

    // Create magic auth
    const magicRes = await req('/user_management/magic_auth', {
      method: 'POST',
      body: JSON.stringify({ email: 'magic@test.com' }),
    });
    const magicBody = await json(magicRes);

    const res = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:workos:oauth:grant-type:magic-auth:code',
        code: magicBody.code,
        email: 'magic@test.com',
      }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.authentication_method).toBe('MagicAuth');
  });

  // --- Device code tests ---

  it('device authorization + device_code grant flow', async () => {
    await createUser('device@test.com');

    // Create device authorization
    const deviceRes = await req('/user_management/authorize/device', {
      method: 'POST',
      body: JSON.stringify({ client_id: 'test_client' }),
    });
    expect(deviceRes.status).toBe(200);
    const deviceBody = await json(deviceRes);
    expect(deviceBody.device_code).toBeDefined();
    expect(deviceBody.user_code).toBeDefined();

    // Exchange device code (auto-approved in emulator)
    const tokenRes = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceBody.device_code,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const tokenBody = await json(tokenRes);
    expect(tokenBody.access_token).toBeDefined();
    expect(tokenBody.user.email).toBe('device@test.com');
  });

  // --- Organization selection grant tests ---

  it('organization-selection grant scopes session to selected org', async () => {
    const user = await createUser('orgsel@test.com');
    const ws = getWorkOSStore(store);
    const org = ws.organizations.insert({
      object: 'organization',
      name: 'Test Org',
      external_id: null,
      metadata: {},
      stripe_customer_id: null,
    });

    // Create a pending auth token
    const pendingToken = 'pending_test_token';
    store.setData(`pending_auth:${pendingToken}`, {
      user_id: user.id,
      organization_id: null,
      auth_method: 'Password',
    });

    const res = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:workos:oauth:grant-type:organization-selection',
        pending_authentication_token: pendingToken,
        organization_id: org.id,
      }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.organization_id).toBe(org.id);
    expect(body.user.email).toBe('orgsel@test.com');
  });

  // --- MFA TOTP grant tests ---

  it('mfa-totp grant with valid code succeeds', async () => {
    const user = await createUser('mfa@test.com');
    const ws = getWorkOSStore(store);

    // Create an auth factor
    const factor = ws.authFactors.insert({
      object: 'authentication_factor',
      user_id: user.id,
      type: 'totp',
      totp: { issuer: 'Test', user: user.email, uri: 'otpauth://...' },
    });

    // Create a challenge
    const challenge = ws.authChallenges.insert({
      object: 'authentication_challenge',
      user_id: user.id,
      factor_id: factor.id,
      expires_at: new Date(Date.now() + 600000).toISOString(),
      code: '123456',
    });

    // Create pending auth
    const pendingToken = 'pending_mfa_token';
    store.setData(`pending_auth:${pendingToken}`, {
      user_id: user.id,
      organization_id: null,
      auth_method: 'MFA',
    });

    const res = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:workos:oauth:grant-type:mfa-totp',
        code: '123456',
        pending_authentication_token: pendingToken,
        authentication_challenge_id: challenge.id,
      }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.access_token).toBeDefined();
    expect(body.authentication_method).toBe('MFA');
  });

  it('mfa-totp grant with invalid code returns error', async () => {
    const user = await createUser('mfa2@test.com');
    const ws = getWorkOSStore(store);

    const factor = ws.authFactors.insert({
      object: 'authentication_factor',
      user_id: user.id,
      type: 'totp',
      totp: { issuer: 'Test', user: user.email, uri: 'otpauth://...' },
    });

    const challenge = ws.authChallenges.insert({
      object: 'authentication_challenge',
      user_id: user.id,
      factor_id: factor.id,
      expires_at: new Date(Date.now() + 600000).toISOString(),
      code: '123456',
    });

    const pendingToken = 'pending_mfa_bad';
    store.setData(`pending_auth:${pendingToken}`, {
      user_id: user.id,
      organization_id: null,
      auth_method: 'MFA',
    });

    const res = await app.request('/user_management/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:workos:oauth:grant-type:mfa-totp',
        code: '000000',
        pending_authentication_token: pendingToken,
        authentication_challenge_id: challenge.id,
      }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe('invalid_one_time_code');
  });
});
