import { type RouteContext, notFound, parseJsonBody, WorkOSApiError } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatMagicAuth, generateCode, expiresIn } from '../helpers.js';

export function magicAuthRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.get('/user_management/magic_auth/:id', (c) => {
    const ma = ws.magicAuths.get(c.req.param('id'));
    if (!ma) throw notFound('Magic Auth');
    return c.json(formatMagicAuth(ma));
  });

  app.post('/user_management/magic_auth', async (c) => {
    const body = await parseJsonBody(c);
    const email = body.email as string | undefined;
    if (!email) {
      throw new WorkOSApiError(400, 'email is required', 'invalid_request');
    }

    const user = ws.users.findOneBy('email', email);
    if (!user) throw notFound('User');

    const ma = ws.magicAuths.insert({
      object: 'magic_auth',
      user_id: user.id,
      email: user.email,
      code: generateCode(),
      expires_at: expiresIn(10),
    });

    return c.json(formatMagicAuth(ma), 201);
  });
}
