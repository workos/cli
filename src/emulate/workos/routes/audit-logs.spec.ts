import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_org: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_org', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Audit Logs routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  it('creates an action schema', async () => {
    const res = await req('/audit_logs/actions/user.login/schemas', {
      method: 'POST',
      body: JSON.stringify({ type: 'object', properties: {} }),
    });
    expect(res.status).toBe(201);
    const action = await json(res);
    expect(action.object).toBe('audit_log_action');
    expect(action.name).toBe('user.login');
  });

  it('lists actions', async () => {
    await req('/audit_logs/actions/user.login/schemas', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await req('/audit_logs/actions');
    expect(res.status).toBe(200);
    const list = await json(res);
    expect(list.object).toBe('list');
    expect(list.data).toHaveLength(1);
  });

  it('creates an audit log event', async () => {
    const res = await req('/audit_logs/events', {
      method: 'POST',
      body: JSON.stringify({
        organization_id: 'org_123',
        action: { name: 'user.login', type: 'C' },
        actor: { type: 'user', id: 'user_1' },
        targets: [{ type: 'team', id: 'team_1' }],
      }),
    });
    expect(res.status).toBe(201);
    const event = await json(res);
    expect(event.object).toBe('audit_log_event');
    expect(event.action.name).toBe('user.login');
    expect(event.organization_id).toBe('org_123');
  });

  it('rejects event without organization_id', async () => {
    const res = await req('/audit_logs/events', {
      method: 'POST',
      body: JSON.stringify({ action: { name: 'test' } }),
    });
    expect(res.status).toBe(422);
  });

  it('creates an export (auto-ready)', async () => {
    const res = await req('/audit_logs/exports', {
      method: 'POST',
      body: JSON.stringify({ organization_id: 'org_123' }),
    });
    expect(res.status).toBe(201);
    const exp = await json(res);
    expect(exp.object).toBe('audit_log_export');
    expect(exp.state).toBe('ready');
    expect(exp.url).toBeDefined();
  });

  it('gets an export by id', async () => {
    const createRes = await req('/audit_logs/exports', {
      method: 'POST',
      body: JSON.stringify({ organization_id: 'org_123' }),
    });
    const created = await json(createRes);

    const res = await req(`/audit_logs/exports/${created.id}`);
    expect(res.status).toBe(200);
    expect((await json(res)).state).toBe('ready');
  });

  it('returns 404 for nonexistent export', async () => {
    const res = await req('/audit_logs/exports/audit_export_nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns org audit log configuration', async () => {
    const res = await req('/organizations/org_123/audit_log_configuration');
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.enabled).toBe(true);
    expect(data.retention_days).toBe(365);
  });

  it('returns org audit logs retention', async () => {
    const res = await req('/organizations/org_123/audit_logs_retention');
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.retention_days).toBe(365);
  });
});
