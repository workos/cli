import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_orgrole: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_orgrole', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Authorization org role routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  async function createOrg(name: string) {
    const res = await req('/organizations', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return json(res);
  }

  it('creates an org role', async () => {
    const org = await createOrg('Test Org');
    const res = await req(`/authorization/organizations/${org.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'org-admin', name: 'Org Admin' }),
    });
    expect(res.status).toBe(201);
    const role = await json(res);
    expect(role.type).toBe('OrganizationRole');
    expect(role.organization_id).toBe(org.id);
    expect(role.slug).toBe('org-admin');
  });

  it('rejects duplicate slug within same org', async () => {
    const org = await createOrg('Dup Org');
    await req(`/authorization/organizations/${org.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'dup', name: 'Dup' }),
    });
    const res = await req(`/authorization/organizations/${org.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'dup', name: 'Dup 2' }),
    });
    expect(res.status).toBe(422);
  });

  it('allows same slug in different orgs', async () => {
    const org1 = await createOrg('Org1');
    const org2 = await createOrg('Org2');
    const res1 = await req(`/authorization/organizations/${org1.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'shared', name: 'Shared' }),
    });
    const res2 = await req(`/authorization/organizations/${org2.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'shared', name: 'Shared' }),
    });
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
  });

  it('lists org roles scoped to org', async () => {
    const org1 = await createOrg('List Org1');
    const org2 = await createOrg('List Org2');
    await req(`/authorization/organizations/${org1.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'r1', name: 'R1' }),
    });
    await req(`/authorization/organizations/${org2.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'r2', name: 'R2' }),
    });

    const res = await req(`/authorization/organizations/${org1.id}/roles`);
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].slug).toBe('r1');
  });

  it('gets an org role by slug', async () => {
    const org = await createOrg('Get Org');
    await req(`/authorization/organizations/${org.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'getter', name: 'Getter' }),
    });
    const res = await req(`/authorization/organizations/${org.id}/roles/getter`);
    expect(res.status).toBe(200);
    const role = await json(res);
    expect(role.slug).toBe('getter');
  });

  it('updates an org role', async () => {
    const org = await createOrg('Upd Org');
    await req(`/authorization/organizations/${org.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'upd', name: 'Original' }),
    });
    const res = await req(`/authorization/organizations/${org.id}/roles/upd`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(200);
    const role = await json(res);
    expect(role.name).toBe('Updated');
  });

  it('deletes an org role', async () => {
    const org = await createOrg('Del Org');
    await req(`/authorization/organizations/${org.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'del', name: 'Del' }),
    });
    const res = await req(`/authorization/organizations/${org.id}/roles/del`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const getRes = await req(`/authorization/organizations/${org.id}/roles/del`);
    expect(getRes.status).toBe(404);
  });

  it('sets role priority ordering', async () => {
    const org = await createOrg('Priority Org');
    await req(`/authorization/organizations/${org.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'low', name: 'Low', priority: 99 }),
    });
    await req(`/authorization/organizations/${org.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'high', name: 'High', priority: 99 }),
    });

    const res = await req(`/authorization/organizations/${org.id}/roles/priority`, {
      method: 'PUT',
      body: JSON.stringify({ slugs: ['high', 'low'] }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data[0].slug).toBe('high');
    expect(body.data[0].priority).toBe(0);
    expect(body.data[1].slug).toBe('low');
    expect(body.data[1].priority).toBe(1);
  });

  it('manages org role permissions', async () => {
    const org = await createOrg('Perm Org');

    // Create permissions
    await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'org-read', name: 'Read' }),
    });
    await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'org-write', name: 'Write' }),
    });

    // Create org role
    await req(`/authorization/organizations/${org.id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ slug: 'org-editor', name: 'Editor' }),
    });

    // Set permissions
    await req(`/authorization/organizations/${org.id}/roles/org-editor/permissions`, {
      method: 'POST',
      body: JSON.stringify({ permissions: ['org-read', 'org-write'] }),
    });

    // Get permissions
    const res = await req(`/authorization/organizations/${org.id}/roles/org-editor/permissions`);
    const body = await json(res);
    expect(body.data.length).toBe(2);

    // Remove one permission
    const delRes = await req(`/authorization/organizations/${org.id}/roles/org-editor/permissions/org-write`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(204);

    // Verify removal
    const afterRes = await req(`/authorization/organizations/${org.id}/roles/org-editor/permissions`);
    const afterBody = await json(afterRes);
    expect(afterBody.data.length).toBe(1);
    expect(afterBody.data[0].slug).toBe('org-read');
  });
});
