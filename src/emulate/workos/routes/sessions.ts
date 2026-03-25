import { type RouteContext, notFound, parseJsonBody, WorkOSApiError } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatSession, assertLocalRedirectUri } from '../helpers.js';

export function sessionRoutes(ctx: RouteContext): void {
  const { app, store, jwt } = ctx;
  const ws = getWorkOSStore(store);

  app.get('/user_management/users/:id/sessions', (c) => {
    const user = ws.users.get(c.req.param('id'));
    if (!user) throw notFound('User');

    const sessions = ws.sessions.findBy('user_id', user.id);
    return c.json({
      object: 'list',
      data: sessions.map(formatSession),
      list_metadata: { before: null, after: null },
    });
  });

  app.post('/user_management/sessions/revoke', async (c) => {
    const body = await parseJsonBody(c);
    const sessionId = body.session_id as string | undefined;
    if (!sessionId) {
      throw new WorkOSApiError(400, 'session_id is required', 'invalid_request');
    }

    const session = ws.sessions.get(sessionId);
    if (!session) throw notFound('Session');

    ws.sessions.delete(session.id);
    return c.json({ success: true });
  });

  // Public endpoint — no auth required (security: [])
  app.get('/user_management/sessions/logout', (c) => {
    const url = new URL(c.req.url);
    const sessionId = url.searchParams.get('session_id');
    const returnTo = url.searchParams.get('return_to');

    if (!sessionId) {
      throw new WorkOSApiError(422, 'session_id is required', 'invalid_request');
    }

    const session = ws.sessions.get(sessionId);
    if (session) ws.sessions.delete(session.id);

    if (returnTo) {
      assertLocalRedirectUri(returnTo);
      return c.redirect(returnTo);
    }
    return c.json({ success: true });
  });

  app.get('/user_management/sessions/jwks/:clientId', (c) => {
    return c.json(jwt.getJWKS());
  });
}
