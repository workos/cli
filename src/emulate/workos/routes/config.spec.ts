import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_config: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_config', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Config routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  describe('Redirect URIs', () => {
    it('creates a redirect URI', async () => {
      const res = await req('/user_management/redirect_uris', {
        method: 'POST',
        body: JSON.stringify({ uri: 'http://localhost:3000/callback' }),
      });
      expect(res.status).toBe(201);
      const data = await json(res);
      expect(data.object).toBe('redirect_uri');
      expect(data.uri).toBe('http://localhost:3000/callback');
      expect(data.id).toMatch(/^redir_/);
    });

    it('rejects duplicate redirect URI', async () => {
      await req('/user_management/redirect_uris', {
        method: 'POST',
        body: JSON.stringify({ uri: 'http://localhost:3000/dup' }),
      });
      const res = await req('/user_management/redirect_uris', {
        method: 'POST',
        body: JSON.stringify({ uri: 'http://localhost:3000/dup' }),
      });
      expect(res.status).toBe(422);
      expect((await json(res)).code).toBe('redirect_uri_already_exists');
    });
  });

  describe('CORS Origins', () => {
    it('creates a CORS origin', async () => {
      const res = await req('/user_management/cors_origins', {
        method: 'POST',
        body: JSON.stringify({ origin: 'http://localhost:3000' }),
      });
      expect(res.status).toBe(201);
      const data = await json(res);
      expect(data.object).toBe('cors_origin');
      expect(data.origin).toBe('http://localhost:3000');
      expect(data.id).toMatch(/^cors_/);
    });

    it('rejects duplicate CORS origin', async () => {
      await req('/user_management/cors_origins', {
        method: 'POST',
        body: JSON.stringify({ origin: 'http://localhost:4000' }),
      });
      const res = await req('/user_management/cors_origins', {
        method: 'POST',
        body: JSON.stringify({ origin: 'http://localhost:4000' }),
      });
      expect(res.status).toBe(422);
      expect((await json(res)).code).toBe('cors_origin_already_exists');
    });
  });

  describe('JWT Template', () => {
    it('gets default JWT template', async () => {
      const res = await req('/user_management/jwt_template');
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.object).toBe('jwt_template');
      expect(data.custom_claims).toEqual({});
    });

    it('updates JWT template', async () => {
      const res = await req('/user_management/jwt_template', {
        method: 'PUT',
        body: JSON.stringify({ custom_claims: { role: '{{user.role}}' } }),
      });
      expect(res.status).toBe(200);
      const data = await json(res);
      expect(data.custom_claims).toEqual({ role: '{{user.role}}' });

      // Verify persistence
      const getRes = await req('/user_management/jwt_template');
      expect((await json(getRes)).custom_claims).toEqual({ role: '{{user.role}}' });
    });
  });
});
