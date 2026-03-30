import {
  type RouteContext,
  notFound,
  validationError,
  parseJsonBody,
  WorkOSApiError,
  parseListParams,
} from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatUser, formatIdentity, hashPassword, formatListResponse } from '../helpers.js';

export function userRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.post('/user_management/users', async (c) => {
    const body = await parseJsonBody(c);
    const email = body.email as string | undefined;
    if (!email) {
      throw validationError('email is required', [{ field: 'email', code: 'required' }]);
    }

    const existing = ws.users.findOneBy('email', email);
    if (existing) {
      throw new WorkOSApiError(409, 'A user with this email already exists', 'user_already_exists');
    }

    const password = body.password as string | undefined;
    const user = ws.users.insert({
      object: 'user',
      email,
      first_name: (body.first_name as string) ?? null,
      last_name: (body.last_name as string) ?? null,
      email_verified: (body.email_verified as boolean) ?? false,
      profile_picture_url: null,
      last_sign_in_at: null,
      external_id: (body.external_id as string) ?? null,
      metadata: (body.metadata as Record<string, string>) ?? {},
      locale: null,
      password_hash: password ? hashPassword(password) : null,
      impersonator: null,
    });

    return c.json(formatUser(user), 201);
  });

  app.get('/user_management/users', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const emailFilter = url.searchParams.get('email') ?? undefined;
    const orgFilter = url.searchParams.get('organization_id') ?? undefined;

    let orgUserIds: Set<string> | undefined;
    if (orgFilter) {
      orgUserIds = new Set(ws.organizationMemberships.findBy('organization_id', orgFilter).map((m) => m.user_id));
    }

    const result = ws.users.list({
      ...params,
      filter: (user) => {
        if (emailFilter && user.email !== emailFilter) return false;
        if (orgUserIds && !orgUserIds.has(user.id)) return false;
        return true;
      },
    });

    return c.json(formatListResponse(result, formatUser));
  });

  app.get('/user_management/users/:id', (c) => {
    const user = ws.users.get(c.req.param('id'));
    if (!user) throw notFound('User');
    return c.json(formatUser(user));
  });

  app.get('/user_management/users/external_id/:external_id', (c) => {
    const user = ws.users.findOneBy('external_id', c.req.param('external_id'));
    if (!user) throw notFound('User');
    return c.json(formatUser(user));
  });

  app.put('/user_management/users/:id', async (c) => {
    const user = ws.users.get(c.req.param('id'));
    if (!user) throw notFound('User');

    const body = await parseJsonBody(c);
    const updates: Record<string, unknown> = {};

    if ('first_name' in body) updates.first_name = body.first_name ?? null;
    if ('last_name' in body) updates.last_name = body.last_name ?? null;
    if ('email_verified' in body) updates.email_verified = body.email_verified;
    if ('external_id' in body) updates.external_id = body.external_id ?? null;
    if ('metadata' in body) updates.metadata = body.metadata ?? {};
    if ('password' in body && body.password) {
      updates.password_hash = hashPassword(body.password as string);
    }

    const updated = ws.users.update(user.id, updates);
    return c.json(formatUser(updated!));
  });

  app.delete('/user_management/users/:id', (c) => {
    const user = ws.users.get(c.req.param('id'));
    if (!user) throw notFound('User');

    for (const s of ws.sessions.findBy('user_id', user.id)) {
      ws.sessions.delete(s.id);
    }
    for (const m of ws.organizationMemberships.findBy('user_id', user.id)) {
      ws.organizationMemberships.delete(m.id);
    }
    for (const f of ws.authFactors.findBy('user_id', user.id)) {
      ws.authFactors.delete(f.id);
    }
    for (const i of ws.identities.findBy('user_id', user.id)) {
      ws.identities.delete(i.id);
    }
    for (const pr of ws.passwordResets.findBy('user_id', user.id)) {
      ws.passwordResets.delete(pr.id);
    }
    for (const ev of ws.emailVerifications.findBy('user_id', user.id)) {
      ws.emailVerifications.delete(ev.id);
    }
    for (const ma of ws.magicAuths.findBy('user_id', user.id)) {
      ws.magicAuths.delete(ma.id);
    }

    ws.users.delete(user.id);
    return c.body(null, 204);
  });

  app.get('/user_management/users/:id/identities', (c) => {
    const user = ws.users.get(c.req.param('id'));
    if (!user) throw notFound('User');

    const identities = ws.identities.findBy('user_id', user.id);
    return c.json({
      object: 'list',
      data: identities.map(formatIdentity),
      list_metadata: { before: null, after: null },
    });
  });
}
