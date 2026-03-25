import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_org: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_org', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Connect routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  it('creates an application', async () => {
    const res = await req('/connect/applications', {
      method: 'POST',
      body: JSON.stringify({ name: 'My App', redirect_uris: ['http://localhost:3000/callback'] }),
    });
    expect(res.status).toBe(201);
    const app = await json(res);
    expect(app.object).toBe('connect_application');
    expect(app.name).toBe('My App');
    expect(app.client_id).toBeDefined();
    expect(app.id).toMatch(/^connect_app_/);
  });

  it('rejects empty name', async () => {
    const res = await req('/connect/applications', {
      method: 'POST',
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('gets an application by id', async () => {
    const createRes = await req('/connect/applications', {
      method: 'POST',
      body: JSON.stringify({ name: 'Get Test' }),
    });
    const created = await json(createRes);

    const res = await req(`/connect/applications/${created.id}`);
    expect(res.status).toBe(200);
    expect((await json(res)).name).toBe('Get Test');
  });

  it('returns 404 for nonexistent application', async () => {
    const res = await req('/connect/applications/connect_app_nonexistent');
    expect(res.status).toBe(404);
  });

  it('lists applications', async () => {
    await req('/connect/applications', {
      method: 'POST',
      body: JSON.stringify({ name: 'App 1' }),
    });
    await req('/connect/applications', {
      method: 'POST',
      body: JSON.stringify({ name: 'App 2' }),
    });

    const res = await req('/connect/applications');
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list.object).toBe('list');
    expect(list.data).toHaveLength(2);
  });

  it('creates and revokes a client secret', async () => {
    const appRes = await req('/connect/applications', {
      method: 'POST',
      body: JSON.stringify({ name: 'Secret Test' }),
    });
    const application = await json(appRes);

    const secretRes = await req(`/connect/applications/${application.id}/client_secrets`, {
      method: 'POST',
    });
    expect(secretRes.status).toBe(201);
    const secret = await json(secretRes);
    expect(secret.object).toBe('client_secret');
    expect(secret.value).toBeDefined();
    expect(secret.last_four).toBe(secret.value.slice(-4));

    const delRes = await req(`/connect/client_secrets/${secret.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);
  });
});
