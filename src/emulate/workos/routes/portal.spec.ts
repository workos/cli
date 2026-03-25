import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_org: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_org', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Portal routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  it('generates a portal link', async () => {
    const res = await req('/portal/generate_link', {
      method: 'POST',
      body: JSON.stringify({ intent: 'sso', organization: 'org_123' }),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.link).toContain('/portal/sso/org_123');
  });

  it('rejects missing intent', async () => {
    const res = await req('/portal/generate_link', {
      method: 'POST',
      body: JSON.stringify({ organization: 'org_123' }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects missing organization', async () => {
    const res = await req('/portal/generate_link', {
      method: 'POST',
      body: JSON.stringify({ intent: 'sso' }),
    });
    expect(res.status).toBe(422);
  });
});
