import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';
import { getWorkOSStore } from '../store.js';

const apiKeys: ApiKeyMap = { sk_test_uf: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_uf', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('User feature routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];
  let store: ReturnType<typeof createTestApp>['store'];

  beforeEach(() => {
    const result = createTestApp();
    app = result.app;
    store = result.store;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  async function createUser(email: string) {
    return json(
      await req('/user_management/users', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    );
  }

  describe('Authorized Applications', () => {
    it('lists authorized applications for user', async () => {
      const user = await createUser('apps@test.com');
      const ws = getWorkOSStore(store);
      ws.authorizedApplications.insert({
        object: 'authorized_application',
        user_id: user.id,
        name: 'Test App',
        redirect_uri: 'http://localhost:3000/callback',
      });

      const res = await req(`/user_management/users/${user.id}/authorized_applications`);
      expect(res.status).toBe(200);
      const list = await json(res);
      expect(list.data).toHaveLength(1);
      expect(list.data[0].name).toBe('Test App');
    });

    it('deletes an authorized application', async () => {
      const user = await createUser('revoke-app@test.com');
      const ws = getWorkOSStore(store);
      const appItem = ws.authorizedApplications.insert({
        object: 'authorized_application',
        user_id: user.id,
        name: 'Revoke App',
        redirect_uri: 'http://localhost:3000/callback',
      });

      const delRes = await req(`/user_management/users/${user.id}/authorized_applications/${appItem.id}`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(204);

      const listRes = await json(await req(`/user_management/users/${user.id}/authorized_applications`));
      expect(listRes.data).toHaveLength(0);
    });

    it('returns 404 for non-existent user', async () => {
      const res = await req('/user_management/users/user_nonexistent/authorized_applications');
      expect(res.status).toBe(404);
    });
  });

  describe('Connected Accounts', () => {
    it('gets connected account by provider slug', async () => {
      const user = await createUser('connected@test.com');
      const ws = getWorkOSStore(store);
      ws.connectedAccounts.insert({
        object: 'connected_account',
        user_id: user.id,
        provider: 'github',
        provider_id: 'gh_123',
      });

      const res = await req(`/user_management/users/${user.id}/connected_accounts/github`);
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.provider).toBe('github');
      expect(data.provider_id).toBe('gh_123');
    });

    it('returns 404 for unknown provider', async () => {
      const user = await createUser('no-provider@test.com');
      const res = await req(`/user_management/users/${user.id}/connected_accounts/unknown`);
      expect(res.status).toBe(404);
    });
  });

  describe('Data Providers', () => {
    it('lists data providers from pipe connections', async () => {
      const user = await createUser('pipes@test.com');
      const ws = getWorkOSStore(store);
      ws.pipeConnections.insert({
        object: 'pipe_connection',
        user_id: user.id,
        provider: 'github',
        scopes: ['read'],
        status: 'connected',
        external_account_id: null,
      });

      const res = await req(`/user_management/users/${user.id}/data_providers`);
      expect(res.status).toBe(200);
      const list = await json(res);
      expect(list.data).toHaveLength(1);
      expect(list.data[0].provider).toBe('github');
    });
  });

  describe('Feature Flags', () => {
    it('returns empty list when no flags exist', async () => {
      const user = await createUser('flags@test.com');
      const res = await req(`/user_management/users/${user.id}/feature-flags`);
      expect(res.status).toBe(200);
      const list = await json(res);
      expect(list.data).toEqual([]);
    });
  });
});
