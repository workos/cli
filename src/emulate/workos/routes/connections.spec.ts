import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_conn: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_conn', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Connection routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  async function createOrg(name: string) {
    return json(
      await req('/organizations', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    );
  }

  it('creates a connection', async () => {
    const org = await createOrg('SSO Org');
    const res = await req('/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test SSO',
        organization_id: org.id,
        connection_type: 'GenericSAML',
        domains: ['sso.example.com'],
      }),
    });
    expect(res.status).toBe(201);
    const conn = await json(res);
    expect(conn.object).toBe('connection');
    expect(conn.organization_id).toBe(org.id);
    expect(conn.domains).toHaveLength(1);
  });

  it('lists connections filtered by org', async () => {
    const org1 = await createOrg('Org 1');
    const org2 = await createOrg('Org 2');

    await req('/connections', {
      method: 'POST',
      body: JSON.stringify({ name: 'C1', organization_id: org1.id }),
    });
    await req('/connections', {
      method: 'POST',
      body: JSON.stringify({ name: 'C2', organization_id: org2.id }),
    });

    const list = await json(await req(`/connections?organization_id=${org1.id}`));
    expect(list.data).toHaveLength(1);
    expect(list.data[0].name).toBe('C1');
  });

  it('gets a connection by id', async () => {
    const org = await createOrg('Conn Org');
    const created = await json(
      await req('/connections', {
        method: 'POST',
        body: JSON.stringify({ name: 'Get Me', organization_id: org.id }),
      }),
    );

    const res = await req(`/connections/${created.id}`);
    expect(res.status).toBe(200);
    expect((await json(res)).name).toBe('Get Me');
  });

  it('deletes a connection', async () => {
    const org = await createOrg('Del Org');
    const conn = await json(
      await req('/connections', {
        method: 'POST',
        body: JSON.stringify({ name: 'Del Conn', organization_id: org.id }),
      }),
    );

    const delRes = await req(`/connections/${conn.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    const getRes = await req(`/connections/${conn.id}`);
    expect(getRes.status).toBe(404);
  });
});
