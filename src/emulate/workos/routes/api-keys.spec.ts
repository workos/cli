import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';
import { getWorkOSStore } from '../store.js';
import type { Store } from '../../core/index.js';

const apiKeys: ApiKeyMap = { sk_test_org: { environment: 'test' }, sk_live_key: { environment: 'production' } };
const headers = { Authorization: 'Bearer sk_test_org', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('API Keys routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let store: Store;

  beforeEach(() => {
    const server = createTestApp();
    app = server.app;
    store = server.store;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  it('validates a known API key', async () => {
    const res = await req('/api_keys/validations', {
      method: 'POST',
      body: JSON.stringify({ key: 'sk_test_org' }),
    });
    expect(res.status).toBe(200);
    expect((await json(res)).valid).toBe(true);
  });

  it('rejects an unknown API key', async () => {
    const res = await req('/api_keys/validations', {
      method: 'POST',
      body: JSON.stringify({ key: 'sk_unknown' }),
    });
    expect(res.status).toBe(200);
    expect((await json(res)).valid).toBe(false);
  });

  it('deletes an API key record', async () => {
    const ws = getWorkOSStore(store);
    const record = ws.apiKeyRecords.insert({
      object: 'api_key',
      name: 'test-key',
      key: 'sk_test_deletable',
      environment: 'test',
    });

    const res = await req(`/api_keys/${record.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
  });

  it('returns 404 for nonexistent API key', async () => {
    const res = await req('/api_keys/api_key_nonexistent', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('lists API key records', async () => {
    const ws = getWorkOSStore(store);
    ws.apiKeyRecords.insert({ object: 'api_key', name: 'key-1', key: 'sk_1', environment: 'test' });
    ws.apiKeyRecords.insert({ object: 'api_key', name: 'key-2', key: 'sk_2', environment: 'test' });

    const res = await req('/organizations/org_123/api_keys');
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list.object).toBe('list');
    expect(list.data).toHaveLength(2);
  });
});
