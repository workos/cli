import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap, type Store } from '../../core/index.js';
import { workosPlugin } from '../index.js';
import { getWorkOSStore } from '../store.js';

const apiKeys: ApiKeyMap = { sk_test_org: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_org', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Directory Sync routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let store: Store;

  beforeEach(() => {
    const server = createTestApp();
    app = server.app;
    store = server.store;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  function seedDirectory() {
    const ws = getWorkOSStore(store);
    const dir = ws.directories.insert({
      object: 'directory',
      name: 'Okta Directory',
      organization_id: 'org_123',
      domain: 'acme.com',
      type: 'okta scim v2.0',
      state: 'linked',
      external_key: 'ext_1',
    });

    const group = ws.directoryGroups.insert({
      object: 'directory_group',
      directory_id: dir.id,
      organization_id: 'org_123',
      idp_id: 'idp_grp_1',
      name: 'Engineering',
      raw_attributes: {},
    });

    const user = ws.directoryUsers.insert({
      object: 'directory_user',
      directory_id: dir.id,
      organization_id: 'org_123',
      idp_id: 'idp_usr_1',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@acme.com',
      username: 'jdoe',
      state: 'active',
      role: null,
      custom_attributes: {},
      raw_attributes: {},
      groups: [{ object: 'directory_group', id: group.id, name: 'Engineering' }],
    });

    return { dir, group, user };
  }

  it('lists directories', async () => {
    seedDirectory();
    const res = await req('/directories');
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].object).toBe('directory');
  });

  it('filters directories by organization_id', async () => {
    seedDirectory();
    const res = await req('/directories?organization_id=org_other');
    const list = await json(res);
    expect(list.data).toHaveLength(0);
  });

  it('filters directories by search', async () => {
    seedDirectory();
    const res = await req('/directories?search=okta');
    const list = await json(res);
    expect(list.data).toHaveLength(1);
  });

  it('gets a directory by id', async () => {
    const { dir } = seedDirectory();
    const res = await req(`/directories/${dir.id}`);
    expect(res.status).toBe(200);
    expect((await json(res)).name).toBe('Okta Directory');
  });

  it('returns 404 for nonexistent directory', async () => {
    const res = await req('/directories/directory_nonexistent');
    expect(res.status).toBe(404);
  });

  it('deletes a directory and cascades', async () => {
    const { dir, user, group } = seedDirectory();
    const delRes = await req(`/directories/${dir.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    expect(await (await req(`/directories/${dir.id}`)).status).toBe(404);
    expect(await (await req(`/directory_users/${user.id}`)).status).toBe(404);
    expect(await (await req(`/directory_groups/${group.id}`)).status).toBe(404);
  });

  it('lists directory users with directory_id filter', async () => {
    const { dir } = seedDirectory();
    const res = await req(`/directory_users?directory_id=${dir.id}`);
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].email).toBe('jane@acme.com');
  });

  it('lists directory users with group_id filter', async () => {
    const { group } = seedDirectory();
    const res = await req(`/directory_users?group_id=${group.id}`);
    const list = await json(res);
    expect(list.data).toHaveLength(1);
  });

  it('gets a directory user by id', async () => {
    const { user } = seedDirectory();
    const res = await req(`/directory_users/${user.id}`);
    expect(res.status).toBe(200);
    expect((await json(res)).first_name).toBe('Jane');
  });

  it('lists directory groups', async () => {
    const { dir } = seedDirectory();
    const res = await req(`/directory_groups?directory_id=${dir.id}`);
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].name).toBe('Engineering');
  });

  it('gets a directory group by id', async () => {
    const { group } = seedDirectory();
    const res = await req(`/directory_groups/${group.id}`);
    expect(res.status).toBe(200);
    expect((await json(res)).name).toBe('Engineering');
  });
});
