import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_check: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_check', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Authorization check + role assignment routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  async function setup() {
    // Create user
    const userRes = await req('/user_management/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'check@test.com' }),
    });
    const user = await json(userRes);

    // Create org
    const orgRes = await req('/organizations', {
      method: 'POST',
      body: JSON.stringify({ name: 'Check Org' }),
    });
    const org = await json(orgRes);

    // Create membership with role_slug 'editor'
    const memRes = await req('/user_management/organization_memberships', {
      method: 'POST',
      body: JSON.stringify({ organization_id: org.id, user_id: user.id, role_slug: 'editor' }),
    });
    const membership = await json(memRes);

    // Create permissions
    await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'posts:read', name: 'Read Posts' }),
    });
    await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'posts:write', name: 'Write Posts' }),
    });
    await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'admin:manage', name: 'Admin Manage' }),
    });

    // Create environment role 'editor' with read+write permissions
    await req('/authorization/roles', {
      method: 'POST',
      body: JSON.stringify({ slug: 'editor', name: 'Editor' }),
    });
    await req('/authorization/roles/editor/permissions', {
      method: 'POST',
      body: JSON.stringify({ permissions: ['posts:read', 'posts:write'] }),
    });

    // Create environment role 'admin' with admin:manage
    const adminRes = await req('/authorization/roles', {
      method: 'POST',
      body: JSON.stringify({ slug: 'admin-role', name: 'Admin' }),
    });
    const adminRole = await json(adminRes);
    await req('/authorization/roles/admin-role/permissions', {
      method: 'POST',
      body: JSON.stringify({ permissions: ['admin:manage'] }),
    });

    return { user, org, membership, adminRole };
  }

  it('returns authorized true when membership has permission via primary role', async () => {
    const { membership } = await setup();
    const res = await req(`/authorization/organization_memberships/${membership.id}/check`, {
      method: 'POST',
      body: JSON.stringify({ permission: 'posts:read' }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.authorized).toBe(true);
  });

  it('returns authorized false when permission not assigned', async () => {
    const { membership } = await setup();
    const res = await req(`/authorization/organization_memberships/${membership.id}/check`, {
      method: 'POST',
      body: JSON.stringify({ permission: 'admin:manage' }),
    });
    const body = await json(res);
    expect(body.authorized).toBe(false);
  });

  it('returns authorized true via additional role assignment', async () => {
    const { membership, adminRole } = await setup();

    // Assign the admin role to the membership
    await req(`/authorization/organization_memberships/${membership.id}/role_assignments`, {
      method: 'POST',
      body: JSON.stringify({ role_id: adminRole.id }),
    });

    // Now should have admin:manage
    const res = await req(`/authorization/organization_memberships/${membership.id}/check`, {
      method: 'POST',
      body: JSON.stringify({ permission: 'admin:manage' }),
    });
    const body = await json(res);
    expect(body.authorized).toBe(true);
  });

  it('lists role assignments', async () => {
    const { membership, adminRole } = await setup();

    await req(`/authorization/organization_memberships/${membership.id}/role_assignments`, {
      method: 'POST',
      body: JSON.stringify({ role_id: adminRole.id }),
    });

    const res = await req(`/authorization/organization_memberships/${membership.id}/role_assignments`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].role_id).toBe(adminRole.id);
    expect(body.data[0].organization_membership_id).toBe(membership.id);
  });

  it('deletes a role assignment', async () => {
    const { membership, adminRole } = await setup();

    const createRes = await req(`/authorization/organization_memberships/${membership.id}/role_assignments`, {
      method: 'POST',
      body: JSON.stringify({ role_id: adminRole.id }),
    });
    const assignment = await json(createRes);

    const delRes = await req(
      `/authorization/organization_memberships/${membership.id}/role_assignments/${assignment.id}`,
      { method: 'DELETE' },
    );
    expect(delRes.status).toBe(204);

    // Verify it's gone
    const listRes = await req(`/authorization/organization_memberships/${membership.id}/role_assignments`);
    const body = await json(listRes);
    expect(body.data.length).toBe(0);
  });

  it('lists resources accessible to membership', async () => {
    const { membership, org } = await setup();

    // Create a resource in the org
    await req('/authorization/resources', {
      method: 'POST',
      body: JSON.stringify({ resource_type_slug: 'doc', external_id: 'res1', organization_id: org.id }),
    });

    const res = await req(`/authorization/organization_memberships/${membership.id}/resources`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].external_id).toBe('res1');
  });

  it('returns 404 for nonexistent membership', async () => {
    const res = await req('/authorization/organization_memberships/om_nonexistent/check', {
      method: 'POST',
      body: JSON.stringify({ permission: 'anything' }),
    });
    expect(res.status).toBe(404);
  });

  it('requires permission field in check', async () => {
    const { membership } = await setup();
    const res = await req(`/authorization/organization_memberships/${membership.id}/check`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });
});
