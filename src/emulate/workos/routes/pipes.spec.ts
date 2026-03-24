import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin, seedFromConfig } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_pipes: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_pipes', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Pipe connection routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  async function createPipeConnection(overrides: Record<string, unknown> = {}) {
    return json(
      await req('/pipes/connections', {
        method: 'POST',
        body: JSON.stringify({
          user_id: 'user_01ABC',
          provider: 'github',
          scopes: ['repo', 'user'],
          ...overrides,
        }),
      }),
    );
  }

  it('creates a pipe connection', async () => {
    const res = await req('/pipes/connections', {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'user_01ABC',
        provider: 'github',
        scopes: ['repo', 'user'],
      }),
    });
    expect(res.status).toBe(201);
    const conn = await json(res);
    expect(conn.object).toBe('pipe_connection');
    expect(conn.id).toMatch(/^pipe_conn_/);
    expect(conn.user_id).toBe('user_01ABC');
    expect(conn.provider).toBe('github');
    expect(conn.scopes).toEqual(['repo', 'user']);
    expect(conn.status).toBe('connected');
    expect(conn.external_account_id).toBeNull();
    expect(conn.created_at).toBeDefined();
    expect(conn.updated_at).toBeDefined();
  });

  it('rejects missing user_id', async () => {
    const res = await req('/pipes/connections', {
      method: 'POST',
      body: JSON.stringify({ provider: 'github', scopes: ['repo'] }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects missing provider', async () => {
    const res = await req('/pipes/connections', {
      method: 'POST',
      body: JSON.stringify({ user_id: 'user_01ABC', scopes: ['repo'] }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects invalid provider', async () => {
    const res = await req('/pipes/connections', {
      method: 'POST',
      body: JSON.stringify({ user_id: 'user_01ABC', provider: 'invalid', scopes: [] }),
    });
    expect(res.status).toBe(422);
  });

  it('lists pipe connections', async () => {
    await createPipeConnection({ provider: 'github' });
    await createPipeConnection({ provider: 'slack', scopes: ['chat:write'] });

    const list = await json(await req('/pipes/connections'));
    expect(list.object).toBe('list');
    expect(list.data).toHaveLength(2);
    expect(list.list_metadata).toBeDefined();
  });

  it('lists connections filtered by user_id', async () => {
    await createPipeConnection({ user_id: 'user_01AAA', provider: 'github' });
    await createPipeConnection({ user_id: 'user_01BBB', provider: 'slack' });

    const list = await json(await req('/pipes/connections?user_id=user_01AAA'));
    expect(list.data).toHaveLength(1);
    expect(list.data[0].user_id).toBe('user_01AAA');
  });

  it('lists connections filtered by provider', async () => {
    await createPipeConnection({ provider: 'github' });
    await createPipeConnection({ provider: 'slack', scopes: ['chat:write'] });

    const list = await json(await req('/pipes/connections?provider=slack'));
    expect(list.data).toHaveLength(1);
    expect(list.data[0].provider).toBe('slack');
  });

  it('gets a pipe connection by id', async () => {
    const created = await createPipeConnection();
    const res = await req(`/pipes/connections/${created.id}`);
    expect(res.status).toBe(200);
    const conn = await json(res);
    expect(conn.id).toBe(created.id);
    expect(conn.provider).toBe('github');
  });

  it('returns 404 for nonexistent pipe connection', async () => {
    const res = await req('/pipes/connections/pipe_conn_nonexistent');
    expect(res.status).toBe(404);
  });

  it('deletes a pipe connection', async () => {
    const created = await createPipeConnection();

    const delRes = await req(`/pipes/connections/${created.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    const getRes = await req(`/pipes/connections/${created.id}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 when deleting nonexistent connection', async () => {
    const res = await req('/pipes/connections/pipe_conn_nonexistent', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('gets access token for connected pipe', async () => {
    const created = await createPipeConnection({
      user_id: 'user_01XYZ',
      provider: 'github',
      scopes: ['repo', 'user'],
    });

    const res = await req(`/pipes/connections/${created.id}/access_token`, { method: 'POST' });
    expect(res.status).toBe(200);
    const token = await json(res);
    expect(token.access_token).toBe('pipes_mock_github_user_01XYZ');
    expect(token.token_type).toBe('bearer');
    expect(token.scopes).toEqual(['repo', 'user']);
    expect(token.expires_in).toBe(3600);
  });

  it('returns 400 for access token on disconnected connection', async () => {
    const { app: seededApp, store } = createTestApp();
    seedFromConfig(store, 'http://localhost:0', {
      pipeConnections: [{ user_id: 'user_01ABC', provider: 'github', scopes: ['repo'], status: 'disconnected' }],
    });

    const list = (await (await seededApp.request('/pipes/connections', { headers })).json()) as any;
    const connId = list.data[0].id;

    const res = await seededApp.request(`/pipes/connections/${connId}/access_token`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe('connection_inactive');
    expect(body.message).toBe('Connection is disconnected');
  });

  it('returns 400 for access token on requires_reauth connection', async () => {
    const { app: seededApp, store } = createTestApp();
    seedFromConfig(store, 'http://localhost:0', {
      pipeConnections: [
        { user_id: 'user_01ABC', provider: 'slack', scopes: ['chat:write'], status: 'requires_reauth' },
      ],
    });

    const list = (await (await seededApp.request('/pipes/connections', { headers })).json()) as any;
    const connId = list.data[0].id;

    const res = await seededApp.request(`/pipes/connections/${connId}/access_token`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe('connection_inactive');
    expect(body.message).toBe('Connection is requires_reauth');
  });

  it('returns 404 for access token on nonexistent connection', async () => {
    const res = await req('/pipes/connections/pipe_conn_nonexistent/access_token', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated request', async () => {
    const res = await app.request('/pipes/connections', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});

describe('Pipe connection seed config', () => {
  it('seeds pipe connections from config', async () => {
    const { app, store } = createTestApp();

    seedFromConfig(store, 'http://localhost:0', {
      pipeConnections: [
        {
          user_id: 'user_01ABC',
          provider: 'github',
          scopes: ['repo', 'user'],
          status: 'connected',
        },
        {
          user_id: 'user_01ABC',
          provider: 'slack',
          scopes: ['chat:write', 'channels:read'],
        },
      ],
    });

    const res = await app.request('/pipes/connections', { headers });
    const list = (await res.json()) as any;
    expect(list.data).toHaveLength(2);

    const github = list.data.find((c: any) => c.provider === 'github');
    expect(github).toBeDefined();
    expect(github.user_id).toBe('user_01ABC');
    expect(github.scopes).toEqual(['repo', 'user']);
    expect(github.status).toBe('connected');

    const slack = list.data.find((c: any) => c.provider === 'slack');
    expect(slack).toBeDefined();
    expect(slack.scopes).toEqual(['chat:write', 'channels:read']);
    expect(slack.status).toBe('connected');
  });

  it('seeds pipe connections with custom status', async () => {
    const { app, store } = createTestApp();

    seedFromConfig(store, 'http://localhost:0', {
      pipeConnections: [
        {
          user_id: 'user_01ABC',
          provider: 'google',
          scopes: ['email'],
          status: 'disconnected',
        },
      ],
    });

    const res = await app.request('/pipes/connections', { headers });
    const list = (await res.json()) as any;
    expect(list.data).toHaveLength(1);
    expect(list.data[0].status).toBe('disconnected');
  });
});
