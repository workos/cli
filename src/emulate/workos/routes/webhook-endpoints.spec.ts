import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_wh: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_wh', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Webhook endpoint routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  it('creates a webhook endpoint with auto-generated secret', async () => {
    const res = await req('/webhook_endpoints', {
      method: 'POST',
      body: JSON.stringify({ endpoint_url: 'http://localhost:3000/webhooks' }),
    });
    expect(res.status).toBe(201);
    const ep = await json(res);
    expect(ep.object).toBe('webhook_endpoint');
    expect(ep.endpoint_url).toBe('http://localhost:3000/webhooks');
    expect(ep.secret).toHaveLength(64); // full hex secret on create
    expect(ep.enabled).toBe(true);
    expect(ep.events).toEqual([]);
    expect(ep.id).toMatch(/^we_/);
  });

  it('creates with custom secret and event filter', async () => {
    const res = await req('/webhook_endpoints', {
      method: 'POST',
      body: JSON.stringify({
        endpoint_url: 'http://localhost:3000/webhooks',
        secret: 'my_custom_secret',
        events: ['user.created', 'user.deleted'],
        description: 'Test endpoint',
      }),
    });
    const ep = await json(res);
    expect(ep.secret).toBe('my_custom_secret');
    expect(ep.events).toEqual(['user.created', 'user.deleted']);
    expect(ep.description).toBe('Test endpoint');
  });

  it('masks secret on GET', async () => {
    const createRes = await req('/webhook_endpoints', {
      method: 'POST',
      body: JSON.stringify({ endpoint_url: 'http://localhost:3000/webhooks' }),
    });
    const created = await json(createRes);

    const getRes = await req(`/webhook_endpoints/${created.id}`);
    const ep = await json(getRes);
    expect(ep.secret).toContain('****');
    expect(ep.secret).not.toBe(created.secret);
  });

  it('masks secret on list', async () => {
    await req('/webhook_endpoints', {
      method: 'POST',
      body: JSON.stringify({ endpoint_url: 'http://localhost:3000/webhooks' }),
    });

    const listRes = await req('/webhook_endpoints');
    const list = await json(listRes);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].secret).toContain('****');
  });

  it('updates a webhook endpoint', async () => {
    const createRes = await req('/webhook_endpoints', {
      method: 'POST',
      body: JSON.stringify({ endpoint_url: 'http://localhost:3000/webhooks' }),
    });
    const created = await json(createRes);

    const updateRes = await req(`/webhook_endpoints/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: false, events: ['user.created'] }),
    });
    const updated = await json(updateRes);
    expect(updated.enabled).toBe(false);
    expect(updated.events).toEqual(['user.created']);
  });

  it('deletes a webhook endpoint', async () => {
    const createRes = await req('/webhook_endpoints', {
      method: 'POST',
      body: JSON.stringify({ endpoint_url: 'http://localhost:3000/webhooks' }),
    });
    const created = await json(createRes);

    const delRes = await req(`/webhook_endpoints/${created.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    const getRes = await req(`/webhook_endpoints/${created.id}`);
    expect(getRes.status).toBe(404);
  });

  it('accepts legacy url on create for backward compatibility', async () => {
    const res = await req('/webhook_endpoints', {
      method: 'POST',
      body: JSON.stringify({ url: 'http://localhost:3000/legacy' }),
    });
    expect(res.status).toBe(201);
    const ep = await json(res);
    expect(ep.endpoint_url).toBe('http://localhost:3000/legacy');
  });

  it('accepts legacy url on update for backward compatibility', async () => {
    const createRes = await req('/webhook_endpoints', {
      method: 'POST',
      body: JSON.stringify({ endpoint_url: 'http://localhost:3000/webhooks' }),
    });
    const created = await json(createRes);
    const updateRes = await req(`/webhook_endpoints/${created.id}`, {
      method: 'PUT',
      body: JSON.stringify({ url: 'http://localhost:3000/updated-legacy' }),
    });
    expect(updateRes.status).toBe(200);
    const updated = await json(updateRes);
    expect(updated.endpoint_url).toBe('http://localhost:3000/updated-legacy');
  });

  it('returns 422 for missing url', async () => {
    const res = await req('/webhook_endpoints', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it('returns 404 for unknown endpoint', async () => {
    const res = await req('/webhook_endpoints/we_nonexistent');
    expect(res.status).toBe(404);
  });
});
