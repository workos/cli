import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap, type Store } from '../../core/index.js';
import { workosPlugin } from '../index.js';
import { getWorkOSStore } from '../store.js';

const apiKeys: ApiKeyMap = { sk_test_org: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_org', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Feature Flags routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let store: Store;

  beforeEach(() => {
    const server = createTestApp();
    app = server.app;
    store = server.store;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  function seedFlag(slug = 'dark-mode', enabled = true) {
    const ws = getWorkOSStore(store);
    return ws.featureFlags.insert({
      object: 'feature_flag',
      slug,
      name: 'Dark Mode',
      description: 'Enable dark mode',
      type: 'boolean',
      default_value: true,
      enabled,
    });
  }

  it('lists feature flags', async () => {
    seedFlag();
    const res = await req('/feature-flags');
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list.object).toBe('list');
    expect(list.data).toHaveLength(1);
    expect(list.data[0].slug).toBe('dark-mode');
  });

  it('gets a flag by slug', async () => {
    seedFlag();
    const res = await req('/feature-flags/dark-mode');
    expect(res.status).toBe(200);
    const flag = await json(res);
    expect(flag.slug).toBe('dark-mode');
    expect(flag.enabled).toBe(true);
  });

  it('returns 404 for nonexistent flag', async () => {
    const res = await req('/feature-flags/nonexistent');
    expect(res.status).toBe(404);
  });

  it('enables a flag', async () => {
    seedFlag('test-flag', false);
    const res = await req('/feature-flags/test-flag/enable', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await json(res)).enabled).toBe(true);
  });

  it('disables a flag', async () => {
    seedFlag('test-flag', true);
    const res = await req('/feature-flags/test-flag/disable', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await json(res)).enabled).toBe(false);
  });

  it('adds and removes a target', async () => {
    seedFlag();

    // Add target
    const addRes = await req('/feature-flags/dark-mode/targets/user_123', {
      method: 'PUT',
      body: JSON.stringify({ value: false, resource_type: 'user' }),
    });
    expect(addRes.status).toBe(201);
    const target = await json(addRes);
    expect(target.resource_id).toBe('user_123');
    expect(target.value).toBe(false);

    // Update target
    const updateRes = await req('/feature-flags/dark-mode/targets/user_123', {
      method: 'PUT',
      body: JSON.stringify({ value: true }),
    });
    expect(updateRes.status).toBe(200);
    expect((await json(updateRes)).value).toBe(true);

    // Remove target
    const delRes = await req('/feature-flags/dark-mode/targets/user_123', { method: 'DELETE' });
    expect(delRes.status).toBe(204);
  });

  it('evaluates flags for organization', async () => {
    seedFlag();
    const ws = getWorkOSStore(store);
    ws.flagTargets.insert({
      object: 'flag_target',
      flag_slug: 'dark-mode',
      resource_id: 'org_abc',
      resource_type: 'organization',
      value: false,
    });

    const res = await req('/organizations/org_abc/feature-flags');
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].value).toBe(false);
  });

  it('evaluates flags for user', async () => {
    seedFlag();

    const res = await req('/user_management/users/user_123/feature-flags');
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list.data).toHaveLength(1);
    // No target for this user, should get default value since enabled
    expect(list.data[0].value).toBe(true);
  });

  it('returns null value for disabled flag without target', async () => {
    seedFlag('disabled-flag', false);

    const res = await req('/user_management/users/user_123/feature-flags');
    const list = await json(res);
    expect(list.data[0].value).toBe(null);
  });
});
