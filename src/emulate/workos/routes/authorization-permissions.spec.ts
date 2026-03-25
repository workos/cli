import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_perm: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_perm', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Authorization permission routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  it('creates a permission', async () => {
    const res = await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'posts:read', name: 'Read Posts' }),
    });
    expect(res.status).toBe(201);
    const perm = await json(res);
    expect(perm.object).toBe('permission');
    expect(perm.slug).toBe('posts:read');
    expect(perm.name).toBe('Read Posts');
    expect(perm.id).toMatch(/^perm_/);
  });

  it('rejects duplicate slug', async () => {
    await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'dup', name: 'Dup' }),
    });
    const res = await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'dup', name: 'Dup 2' }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects missing slug', async () => {
    const res = await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ name: 'No Slug' }),
    });
    expect(res.status).toBe(422);
  });

  it('lists permissions', async () => {
    await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'a', name: 'A' }),
    });
    await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'b', name: 'B' }),
    });
    const res = await req('/authorization/permissions');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.object).toBe('list');
    expect(body.data.length).toBe(2);
  });

  it('gets a permission by slug', async () => {
    await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'test-get', name: 'Test' }),
    });
    const res = await req('/authorization/permissions/test-get');
    expect(res.status).toBe(200);
    const perm = await json(res);
    expect(perm.slug).toBe('test-get');
  });

  it('returns 404 for unknown slug', async () => {
    const res = await req('/authorization/permissions/nonexistent');
    expect(res.status).toBe(404);
  });

  it('updates a permission', async () => {
    await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'upd', name: 'Original' }),
    });
    const res = await req('/authorization/permissions/upd', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated', description: 'desc' }),
    });
    expect(res.status).toBe(200);
    const perm = await json(res);
    expect(perm.name).toBe('Updated');
    expect(perm.description).toBe('desc');
  });

  it('deletes a permission', async () => {
    await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'del', name: 'Del' }),
    });
    const res = await req('/authorization/permissions/del', { method: 'DELETE' });
    expect(res.status).toBe(204);

    const getRes = await req('/authorization/permissions/del');
    expect(getRes.status).toBe(404);
  });

  it('cascade deletes permission from role-permission joins', async () => {
    // Create permission + role + link
    await req('/authorization/permissions', {
      method: 'POST',
      body: JSON.stringify({ slug: 'cascade-perm', name: 'Cascade' }),
    });
    await req('/authorization/roles', {
      method: 'POST',
      body: JSON.stringify({ slug: 'cascade-role', name: 'Cascade Role' }),
    });
    await req('/authorization/roles/cascade-role/permissions', {
      method: 'POST',
      body: JSON.stringify({ permissions: ['cascade-perm'] }),
    });

    // Delete the permission
    await req('/authorization/permissions/cascade-perm', { method: 'DELETE' });

    // Role should have no permissions now
    const res = await req('/authorization/roles/cascade-role/permissions');
    const body = await json(res);
    expect(body.data.length).toBe(0);
  });
});
