import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_sso: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_sso', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('SSO routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  async function createOrgWithConnection() {
    const org = await json(
      await req('/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'SSO Org' }),
      }),
    );
    const conn = await json(
      await req('/connections', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test SSO',
          organization_id: org.id,
          connection_type: 'GenericSAML',
          domains: ['sso.example.com'],
        }),
      }),
    );
    return { org, conn };
  }

  it('sso authorize flow with connection', async () => {
    const { conn } = await createOrgWithConnection();

    const res = await app.request(
      `/sso/authorize?connection=${conn.id}&redirect_uri=http://localhost:3000/callback&state=abc`,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    const url = new URL(location);
    expect(url.searchParams.get('code')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe('abc');
  });

  it('sso token exchange returns profile and access_token', async () => {
    const { conn } = await createOrgWithConnection();

    // Get code
    const authRes = await app.request(
      `/sso/authorize?connection=${conn.id}&redirect_uri=http://localhost:3000/callback`,
    );
    const location = authRes.headers.get('location')!;
    const code = new URL(location).searchParams.get('code')!;

    // Exchange
    const tokenRes = await app.request('/sso/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const body = await json(tokenRes);
    expect(body.profile).toBeDefined();
    expect(body.profile.object).toBe('profile');
    expect(body.access_token).toBeDefined();
  });

  it('returns 404 when no active connection found', async () => {
    const res = await app.request(
      '/sso/authorize?connection=conn_nonexistent&redirect_uri=http://localhost:3000/callback',
    );
    expect(res.status).toBe(404);
  });

  it('jwks endpoint returns keys', async () => {
    const res = await app.request('/sso/jwks');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].alg).toBe('RS256');
  });

  it('sso authorize rejects non-localhost redirect_uri', async () => {
    const { conn } = await createOrgWithConnection();

    const res = await app.request(
      `/sso/authorize?connection=${conn.id}&redirect_uri=https://evil.example.com/callback`,
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe('invalid_redirect_uri');
  });
});
