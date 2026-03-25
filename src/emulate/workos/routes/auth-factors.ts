import { type RouteContext, notFound, parseJsonBody } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatAuthFactor } from '../helpers.js';
import { randomBytes } from 'node:crypto';

export function authFactorRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.post('/user_management/users/:userlandUserId/auth_factors', async (c) => {
    const userId = c.req.param('userlandUserId');
    const user = ws.users.get(userId);
    if (!user) throw notFound('User');

    const body = await parseJsonBody(c);
    const type = (body.type as string) ?? 'totp';
    const issuer = (body.totp_issuer as string) ?? 'WorkOS Emulator';
    const secret = randomBytes(20).toString('hex').slice(0, 32).toUpperCase();
    const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

    const factor = ws.authFactors.insert({
      object: 'authentication_factor',
      user_id: user.id,
      type: type as 'totp',
      totp: {
        issuer,
        user: user.email,
        uri,
      },
    });

    return c.json(formatAuthFactor(factor), 201);
  });

  app.get('/user_management/users/:userlandUserId/auth_factors', (c) => {
    const userId = c.req.param('userlandUserId');
    const user = ws.users.get(userId);
    if (!user) throw notFound('User');

    const factors = ws.authFactors.findBy('user_id', user.id);
    return c.json({
      object: 'list',
      data: factors.map(formatAuthFactor),
      list_metadata: { before: null, after: null },
    });
  });

  app.delete('/user_management/auth_factors/:id', (c) => {
    const factorId = c.req.param('id');
    const factor = ws.authFactors.get(factorId);
    if (!factor) throw notFound('AuthenticationFactor');

    ws.authFactors.delete(factor.id);
    return c.body(null, 204);
  });
}
