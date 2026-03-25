import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_auth: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_auth', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Auth routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  it('authorize redirects with code when user exists', async () => {
    // Create a user first
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

    // Get the code via authorize
    const authRes = await app.request(
      '/user_management/authorize?redirect_uri=http://localhost:3000/callback&response_type=code',
    );
    const location = authRes.headers.get('location')!;
    const code = new URL(location).searchParams.get('code')!;

    // Exchange code
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
});
