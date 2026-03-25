import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin, getWorkOSStore } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_ev: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_ev', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Events routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let store: ReturnType<typeof createTestApp>['store'];

  beforeEach(() => {
    const server = createTestApp();
    app = server.app;
    store = server.store;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  it('lists events', async () => {
    const ws = getWorkOSStore(store);
    ws.events.insert({ object: 'event', event: 'user.created', data: { id: 'user_1' }, environment_id: null });
    ws.events.insert({ object: 'event', event: 'organization.created', data: { id: 'org_1' }, environment_id: null });

    const res = await req('/events');
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list.object).toBe('list');
    expect(list.data).toHaveLength(2);
    expect(list.data[0].object).toBe('event');
  });

  it('filters events by type', async () => {
    const ws = getWorkOSStore(store);
    ws.events.insert({ object: 'event', event: 'user.created', data: {}, environment_id: null });
    ws.events.insert({ object: 'event', event: 'user.updated', data: {}, environment_id: null });
    ws.events.insert({ object: 'event', event: 'organization.created', data: {}, environment_id: null });

    const res = await req('/events?events[]=user.created&events[]=user.updated');
    const list = await json(res);
    expect(list.data).toHaveLength(2);
    expect(list.data.every((e: any) => e.event.startsWith('user.'))).toBe(true);
  });

  it('returns empty list when no events', async () => {
    const res = await req('/events');
    const list = await json(res);
    expect(list.data).toHaveLength(0);
  });

  it('event from user creation appears in events list', async () => {
    // Create a user which should trigger an event via collection hooks
    await req('/user_management/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
    });

    const res = await req('/events');
    const list = await json(res);
    const userEvents = list.data.filter((e: any) => e.event === 'user.created');
    expect(userEvents.length).toBeGreaterThanOrEqual(1);
  });
});
