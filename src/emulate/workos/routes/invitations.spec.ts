import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, type ApiKeyMap } from '../../core/index.js';
import { workosPlugin } from '../index.js';

const apiKeys: ApiKeyMap = { sk_test_inv: { environment: 'test' } };
const headers = { Authorization: 'Bearer sk_test_inv', 'Content-Type': 'application/json' };

function createTestApp() {
  return createServer(workosPlugin, { port: 0, baseUrl: 'http://localhost:0', apiKeys });
}

describe('Invitation routes', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    app = createTestApp().app;
  });

  const req = (path: string, init?: RequestInit) => app.request(path, { headers, ...init });
  const json = (res: Response) => res.json() as Promise<any>;

  it('creates an invitation', async () => {
    const res = await req('/user_management/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'invite@test.com' }),
    });
    expect(res.status).toBe(201);
    const inv = await json(res);
    expect(inv.object).toBe('invitation');
    expect(inv.email).toBe('invite@test.com');
    expect(inv.state).toBe('pending');
    expect(inv.token).toBeDefined();
    expect(inv.accept_invitation_url).toContain(inv.token);
    expect(inv.id).toMatch(/^inv_/);
  });

  it('lists invitations with email filter', async () => {
    await req('/user_management/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@test.com' }),
    });
    await req('/user_management/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'b@test.com' }),
    });

    const list = await json(await req('/user_management/invitations?email=a@test.com'));
    expect(list.data).toHaveLength(1);
    expect(list.data[0].email).toBe('a@test.com');
  });

  it('lists invitations with organization_id filter', async () => {
    await req('/user_management/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'org@test.com', organization_id: 'org_123' }),
    });
    await req('/user_management/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'no-org@test.com' }),
    });

    const list = await json(await req('/user_management/invitations?organization_id=org_123'));
    expect(list.data).toHaveLength(1);
    expect(list.data[0].email).toBe('org@test.com');
  });

  it('gets invitation by id', async () => {
    const created = await json(
      await req('/user_management/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: 'get@test.com' }),
      }),
    );

    const res = await req(`/user_management/invitations/${created.id}`);
    expect(res.status).toBe(200);
    expect((await json(res)).email).toBe('get@test.com');
  });

  it('gets invitation by token', async () => {
    const created = await json(
      await req('/user_management/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: 'token@test.com' }),
      }),
    );

    const res = await req(`/user_management/invitations/by_token/${created.token}`);
    expect(res.status).toBe(200);
    expect((await json(res)).email).toBe('token@test.com');
  });

  it('accepts an invitation', async () => {
    const created = await json(
      await req('/user_management/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: 'accept@test.com' }),
      }),
    );

    const res = await req(`/user_management/invitations/${created.id}/accept`, { method: 'POST' });
    expect(res.status).toBe(200);
    const accepted = await json(res);
    expect(accepted.state).toBe('accepted');
  });

  it('accepts invitation with org creates membership', async () => {
    // Create a user and org first
    await req('/user_management/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'member@test.com' }),
    });
    const org = await json(
      await req('/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Org' }),
      }),
    );

    const inv = await json(
      await req('/user_management/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: 'member@test.com', organization_id: org.id }),
      }),
    );

    await req(`/user_management/invitations/${inv.id}/accept`, { method: 'POST' });

    // Check membership was created
    const memberships = await json(await req(`/user_management/organization_memberships?organization_id=${org.id}`));
    expect(memberships.data).toHaveLength(1);
    expect(memberships.data[0].organization_id).toBe(org.id);
  });

  it('revokes an invitation', async () => {
    const created = await json(
      await req('/user_management/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: 'revoke@test.com' }),
      }),
    );

    const res = await req(`/user_management/invitations/${created.id}/revoke`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await json(res)).state).toBe('revoked');
  });

  it('rejects accept on non-pending invitation', async () => {
    const created = await json(
      await req('/user_management/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: 'twice@test.com' }),
      }),
    );

    await req(`/user_management/invitations/${created.id}/revoke`, { method: 'POST' });

    const res = await req(`/user_management/invitations/${created.id}/accept`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('resends an invitation with new token', async () => {
    const created = await json(
      await req('/user_management/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: 'resend@test.com' }),
      }),
    );
    const originalToken = created.token;

    const res = await req(`/user_management/invitations/${created.id}/resend`, { method: 'POST' });
    expect(res.status).toBe(200);
    const resent = await json(res);
    expect(resent.token).not.toBe(originalToken);
    expect(resent.state).toBe('pending');
    expect(resent.accept_invitation_url).toContain(resent.token);
  });

  it('deletes an invitation', async () => {
    const created = await json(
      await req('/user_management/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: 'delete@test.com' }),
      }),
    );

    const delRes = await req(`/user_management/invitations/${created.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    const getRes = await req(`/user_management/invitations/${created.id}`);
    expect(getRes.status).toBe(404);
  });
});
