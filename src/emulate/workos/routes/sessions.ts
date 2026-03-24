import { type RouteContext, notFound, parseJsonBody, WorkOSApiError } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatSession } from '../helpers.js';

export function sessionRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
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
}
