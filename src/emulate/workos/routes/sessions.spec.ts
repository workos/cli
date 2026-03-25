import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';
import { getWorkOSStore } from '../store.js';
import type { Store } from '../../core/index.js';

const apiKeys: ApiKeyMap = { sk_test_session: { environment: 'test' } };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Session routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let store: Store;

  beforeEach(() => {
    const server = createTestApp();
    app = server.app;
    store = server.store;
  });

  const json = (res: Response) => res.json() as Promise<any>;

  it('logout redirects to return_to when provided', async () => {
    const ws = getWorkOSStore(store);
    const user = ws.users.insert({
      object: 'user',
      email: 'logout@test.com',
      first_name: null,
      last_name: null,
      email_verified: false,
      profile_picture_url: null,
      last_sign_in_at: null,
      external_id: null,
      metadata: {},
      locale: null,
      password_hash: null,
      impersonator: null,
    });
    const session = ws.sessions.insert({
      object: 'session',
      user_id: user.id,
      organization_id: null,
      ip_address: null,
      user_agent: null,
    });

    const res = await app.request(
      `/user_management/sessions/logout?session_id=${session.id}&return_to=http://localhost:3000/logged-out`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3000/logged-out');

    // Session should be deleted
    expect(ws.sessions.get(session.id)).toBeUndefined();
  });

  it('logout returns JSON when no return_to', async () => {
    const ws = getWorkOSStore(store);
    const user = ws.users.insert({
      object: 'user',
      email: 'logout2@test.com',
      first_name: null,
      last_name: null,
      email_verified: false,
      profile_picture_url: null,
      last_sign_in_at: null,
      external_id: null,
      metadata: {},
      locale: null,
      password_hash: null,
      impersonator: null,
    });
    const session = ws.sessions.insert({
      object: 'session',
      user_id: user.id,
      organization_id: null,
      ip_address: null,
      user_agent: null,
    });

    const res = await app.request(`/user_management/sessions/logout?session_id=${session.id}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
  });

  it('logout returns 422 when session_id missing', async () => {
    const res = await app.request('/user_management/sessions/logout');
    expect(res.status).toBe(422);
  });

  it('logout succeeds even if session does not exist', async () => {
    const res = await app.request('/user_management/sessions/logout?session_id=session_nonexistent');
    expect(res.status).toBe(200);
  });

  it('jwks endpoint returns keys', async () => {
    const res = await app.request('/user_management/sessions/jwks/test_client');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].alg).toBe('RS256');
  });
});
