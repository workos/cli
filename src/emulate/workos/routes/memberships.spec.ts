import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_mem: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_mem', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Membership routes', () => {
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

  async function createUser(email: string) {
    return json(
      await req('/user_management/users', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    );
  }

  it('creates a membership', async () => {
    const org = await createOrg('Mem Org');
    const user = await createUser('member@test.com');

    const res = await req('/user_management/organization_memberships', {
      method: 'POST',
      body: JSON.stringify({
        organization_id: org.id,
        user_id: user.id,
        role_slug: 'admin',
      }),
    });
    expect(res.status).toBe(201);
    const m = await json(res);
    expect(m.object).toBe('organization_membership');
    expect(m.role.slug).toBe('admin');
    expect(m.status).toBe('active');
  });

  it('rejects duplicate active membership', async () => {
    const org = await createOrg('Dup Org');
    const user = await createUser('dup@test.com');

    await req('/user_management/organization_memberships', {
      method: 'POST',
      body: JSON.stringify({ organization_id: org.id, user_id: user.id }),
    });

    const res = await req('/user_management/organization_memberships', {
      method: 'POST',
      body: JSON.stringify({ organization_id: org.id, user_id: user.id }),
    });
    expect(res.status).toBe(409);
  });

  it('lists memberships filtered by org', async () => {
    const org = await createOrg('List Org');
    const u1 = await createUser('m1@test.com');
    const u2 = await createUser('m2@test.com');

    await req('/user_management/organization_memberships', {
      method: 'POST',
      body: JSON.stringify({ organization_id: org.id, user_id: u1.id }),
    });
    await req('/user_management/organization_memberships', {
      method: 'POST',
      body: JSON.stringify({ organization_id: org.id, user_id: u2.id }),
    });

    const list = await json(await req(`/user_management/organization_memberships?organization_id=${org.id}`));
    expect(list.data).toHaveLength(2);
  });

  it('deactivates and reactivates a membership', async () => {
    const org = await createOrg('Toggle Org');
    const user = await createUser('toggle@test.com');

    const m = await json(
      await req('/user_management/organization_memberships', {
        method: 'POST',
        body: JSON.stringify({ organization_id: org.id, user_id: user.id }),
      }),
    );

    const deactivated = await json(
      await req(`/user_management/organization_memberships/${m.id}/deactivate`, { method: 'PUT' }),
    );
    expect(deactivated.status).toBe('inactive');

    const reactivated = await json(
      await req(`/user_management/organization_memberships/${m.id}/reactivate`, { method: 'PUT' }),
    );
    expect(reactivated.status).toBe('active');
  });
});
