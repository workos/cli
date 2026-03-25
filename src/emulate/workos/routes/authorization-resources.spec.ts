import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_res: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_res', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Authorization resource routes', () => {
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

  it('creates a resource', async () => {
    const org = await createOrg('Res Org');
    const res = await req('/authorization/resources', {
      method: 'POST',
      body: JSON.stringify({
        resource_type_slug: 'document',
        external_id: 'doc-123',
        organization_id: org.id,
      }),
    });
    expect(res.status).toBe(201);
    const resource = await json(res);
    expect(resource.object).toBe('authorization_resource');
    expect(resource.resource_type_slug).toBe('document');
    expect(resource.external_id).toBe('doc-123');
    expect(resource.organization_id).toBe(org.id);
    expect(resource.id).toMatch(/^auth_res_/);
  });

  it('rejects missing required fields', async () => {
    const res = await req('/authorization/resources', {
      method: 'POST',
      body: JSON.stringify({ resource_type_slug: 'document' }),
    });
    expect(res.status).toBe(422);
  });

  it('lists resources', async () => {
    const org = await createOrg('List Org');
    await req('/authorization/resources', {
      method: 'POST',
      body: JSON.stringify({ resource_type_slug: 'doc', external_id: '1', organization_id: org.id }),
    });
    await req('/authorization/resources', {
      method: 'POST',
      body: JSON.stringify({ resource_type_slug: 'doc', external_id: '2', organization_id: org.id }),
    });

    const res = await req('/authorization/resources');
    const body = await json(res);
    expect(body.object).toBe('list');
    expect(body.data.length).toBe(2);
  });

  it('filters resources by organization_id', async () => {
    const org1 = await createOrg('Filter Org1');
    const org2 = await createOrg('Filter Org2');
    await req('/authorization/resources', {
      method: 'POST',
      body: JSON.stringify({ resource_type_slug: 'doc', external_id: '1', organization_id: org1.id }),
    });
    await req('/authorization/resources', {
      method: 'POST',
      body: JSON.stringify({ resource_type_slug: 'doc', external_id: '2', organization_id: org2.id }),
    });

    const res = await req(`/authorization/resources?organization_id=${org1.id}`);
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].organization_id).toBe(org1.id);
  });

  it('gets a resource by id', async () => {
    const org = await createOrg('Get Org');
    const createRes = await req('/authorization/resources', {
      method: 'POST',
      body: JSON.stringify({ resource_type_slug: 'doc', external_id: 'get1', organization_id: org.id }),
    });
    const resource = await json(createRes);

    const res = await req(`/authorization/resources/${resource.id}`);
    expect(res.status).toBe(200);
    const fetched = await json(res);
    expect(fetched.id).toBe(resource.id);
  });

  it('updates a resource', async () => {
    const org = await createOrg('Upd Org');
    const createRes = await req('/authorization/resources', {
      method: 'POST',
      body: JSON.stringify({ resource_type_slug: 'doc', external_id: 'upd1', organization_id: org.id }),
    });
    const resource = await json(createRes);

    const res = await req(`/authorization/resources/${resource.id}`, {
      method: 'PUT',
      body: JSON.stringify({ metadata: { key: 'value' } }),
    });
    expect(res.status).toBe(200);
    const updated = await json(res);
    expect(updated.metadata).toEqual({ key: 'value' });
  });

  it('deletes a resource', async () => {
    const org = await createOrg('Del Org');
    const createRes = await req('/authorization/resources', {
      method: 'POST',
      body: JSON.stringify({ resource_type_slug: 'doc', external_id: 'del1', organization_id: org.id }),
    });
    const resource = await json(createRes);

    const res = await req(`/authorization/resources/${resource.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const getRes = await req(`/authorization/resources/${resource.id}`);
    expect(getRes.status).toBe(404);
  });

  it('gets resource by type + external_id within org', async () => {
    const org = await createOrg('TypeExt Org');
    await req('/authorization/resources', {
      method: 'POST',
      body: JSON.stringify({ resource_type_slug: 'project', external_id: 'proj-42', organization_id: org.id }),
    });

    const res = await req(`/authorization/organizations/${org.id}/resources/project/proj-42`);
    expect(res.status).toBe(200);
    const resource = await json(res);
    expect(resource.resource_type_slug).toBe('project');
    expect(resource.external_id).toBe('proj-42');
  });

  it('lists memberships for a resource', async () => {
    const org = await createOrg('Mem Org');
    // Create a user and membership
    const userRes = await req('/user_management/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'member@test.com' }),
    });
    const user = await json(userRes);
    await req('/user_management/organization_memberships', {
      method: 'POST',
      body: JSON.stringify({ organization_id: org.id, user_id: user.id }),
    });

    // Create resource
    const resCreate = await req('/authorization/resources', {
      method: 'POST',
      body: JSON.stringify({ resource_type_slug: 'doc', external_id: 'mem1', organization_id: org.id }),
    });
    const resource = await json(resCreate);

    const res = await req(`/authorization/resources/${resource.id}/organization_memberships`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].user_id).toBe(user.id);
  });
});
