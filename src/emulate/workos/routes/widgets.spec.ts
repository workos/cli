import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_widgets: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_widgets', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Widget routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  it('generates a widgets token', async () => {
    const res = await req('/widgets/token', {
      method: 'POST',
      body: JSON.stringify({
        organization_id: 'org_123',
        user_id: 'user_456',
        scopes: ['widgets:users-table:manage'],
      }),
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.token).toBeDefined();
    expect(typeof data.token).toBe('string');
    // JWT has 3 dot-separated parts
    expect(data.token.split('.')).toHaveLength(3);
  });

  it('requires organization_id', async () => {
    const res = await req('/widgets/token', {
      method: 'POST',
      body: JSON.stringify({ user_id: 'user_456', scopes: ['read'] }),
    });
    expect(res.status).toBe(422);
  });

  it('requires user_id', async () => {
    const res = await req('/widgets/token', {
      method: 'POST',
      body: JSON.stringify({ organization_id: 'org_123', scopes: ['read'] }),
    });
    expect(res.status).toBe(422);
  });

  it('requires scopes', async () => {
    const res = await req('/widgets/token', {
      method: 'POST',
      body: JSON.stringify({ organization_id: 'org_123', user_id: 'user_456' }),
    });
    expect(res.status).toBe(422);
  });
});
