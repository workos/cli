import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap, type Store } from '../../core/index.js';
import { workosPlugin } from '../index.js';
import { getWorkOSStore } from '../store.js';

const apiKeys: ApiKeyMap = { sk_test_org: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_org', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Radar routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let store: Store;

  beforeEach(() => {
    const server = createTestApp();
    app = server.app;
    store = server.store;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  it('lists radar attempts', async () => {
    const ws = getWorkOSStore(store);
    ws.radarAttempts.insert({
      object: 'radar_attempt',
      user_id: null,
      ip_address: '1.2.3.4',
      user_agent: 'test-agent',
      verdict: 'allow',
      signals: [],
    });

    const res = await req('/radar/attempts');
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list.object).toBe('list');
    expect(list.data).toHaveLength(1);
    expect(list.data[0].ip_address).toBe('1.2.3.4');
  });

  it('gets an attempt by id', async () => {
    const ws = getWorkOSStore(store);
    const attempt = ws.radarAttempts.insert({
      object: 'radar_attempt',
      user_id: null,
      ip_address: '5.6.7.8',
      user_agent: null,
      verdict: 'allow',
      signals: [{ type: 'geo', confidence: 0.9 }],
    });

    const res = await req(`/radar/attempts/${attempt.id}`);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.ip_address).toBe('5.6.7.8');
    expect(data.signals).toHaveLength(1);
  });

  it('returns 404 for nonexistent attempt', async () => {
    const res = await req('/radar/attempts/radar_attempt_nonexistent');
    expect(res.status).toBe(404);
  });

  it('adds and removes entries from allow list', async () => {
    const addRes = await req('/radar/lists/ip/add', {
      method: 'POST',
      body: JSON.stringify({ entries: ['1.2.3.4', '5.6.7.8'] }),
    });
    expect(addRes.status).toBe(200);
    expect((await json(addRes)).success).toBe(true);

    const removeRes = await req('/radar/lists/ip/remove', {
      method: 'POST',
      body: JSON.stringify({ entries: ['1.2.3.4'] }),
    });
    expect(removeRes.status).toBe(200);

    const list = store.getData<Set<string>>('radar_ip_list');
    expect(list?.has('5.6.7.8')).toBe(true);
    expect(list?.has('1.2.3.4')).toBe(false);
  });
});
