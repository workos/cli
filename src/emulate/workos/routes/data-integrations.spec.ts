import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_org: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_org', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Data Integrations routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  it('authorize redirects with code', async () => {
    const res = await app.request(
      '/data-integrations/salesforce/authorize?redirect_uri=http://localhost:3000/callback&state=xyz',
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('Location')!;
    expect(location).toContain('code=');
    expect(location).toContain('state=xyz');
  });

  it('authorize rejects missing redirect_uri', async () => {
    const res = await app.request('/data-integrations/salesforce/authorize');
    expect(res.status).toBe(400);
  });

  it('authorize rejects non-localhost redirect_uri', async () => {
    const res = await app.request('/data-integrations/salesforce/authorize?redirect_uri=https://evil.com/callback');
    expect(res.status).toBe(400);
  });

  it('exchanges code for token', async () => {
    // First authorize to get a code
    const authRes = await app.request(
      '/data-integrations/salesforce/authorize?redirect_uri=http://localhost:3000/callback',
      { redirect: 'manual' },
    );
    const location = authRes.headers.get('Location')!;
    const code = new URL(location).searchParams.get('code')!;

    // Exchange code
    const tokenRes = await req('/data-integrations/salesforce/token', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    expect(tokenRes.status).toBe(200);
    const data = await json(tokenRes);
    expect(data.access_token).toBeDefined();
    expect(data.token_type).toBe('bearer');
  });

  it('rejects invalid code', async () => {
    const res = await req('/data-integrations/salesforce/token', {
      method: 'POST',
      body: JSON.stringify({ code: 'invalid_code' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects code reuse', async () => {
    const authRes = await app.request(
      '/data-integrations/github/authorize?redirect_uri=http://localhost:3000/callback',
      { redirect: 'manual' },
    );
    const code = new URL(authRes.headers.get('Location')!).searchParams.get('code')!;

    // First use succeeds
    await req('/data-integrations/github/token', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });

    // Second use fails
    const res = await req('/data-integrations/github/token', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(400);
  });
});
