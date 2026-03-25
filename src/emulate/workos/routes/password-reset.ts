import { type RouteContext, notFound, parseJsonBody, WorkOSApiError } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatPasswordReset, generateVerificationToken, hashPassword, expiresIn, isExpired } from '../helpers.js';

export function passwordResetRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.get('/user_management/password_reset/:id', (c) => {
    const pr = ws.passwordResets.get(c.req.param('id'));
    if (!pr) throw notFound('Password Reset');
    return c.json(formatPasswordReset(pr));
  });

  app.post('/user_management/password_reset', async (c) => {
    const body = await parseJsonBody(c);
    const email = body.email as string | undefined;
    if (!email) {
      throw new WorkOSApiError(400, 'email is required', 'invalid_request');
    }

    const user = ws.users.findOneBy('email', email);
    if (!user) throw notFound('User');

    const pr = ws.passwordResets.insert({
      object: 'password_reset',
      user_id: user.id,
      email: user.email,
      token: generateVerificationToken(),
      expires_at: expiresIn(60),
    });

    return c.json(formatPasswordReset(pr), 201);
  });

  app.post('/user_management/password_reset/confirm', async (c) => {
    const body = await parseJsonBody(c);
    const token = body.token as string | undefined;
    const newPassword = body.new_password as string | undefined;

    if (!token) {
      throw new WorkOSApiError(400, 'token is required', 'invalid_request');
    }
    if (!newPassword) {
      throw new WorkOSApiError(400, 'new_password is required', 'invalid_request');
    }

    const resets = ws.passwordResets.all();
    const pr = resets.find((r) => r.token === token);
    if (!pr) {
      throw new WorkOSApiError(400, 'Invalid token', 'invalid_token');
    }
    if (isExpired(pr.expires_at)) {
      throw new WorkOSApiError(400, 'Token has expired', 'expired_token');
    }

    const user = ws.users.get(pr.user_id);
    if (!user) {
      ws.passwordResets.delete(pr.id);
      throw notFound('User');
    }

    ws.users.update(pr.user_id, {
      password_hash: hashPassword(newPassword),
    });
    ws.passwordResets.delete(pr.id);

    return c.json({ user: { object: 'user', id: user.id, email: user.email } });
  });
}
