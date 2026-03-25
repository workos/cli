import { type RouteContext, notFound, parseJsonBody, WorkOSApiError } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatAuthFactor, formatAuthChallenge, expiresIn, isExpired, generateCode } from '../helpers.js';
import { randomBytes } from 'node:crypto';

export function legacyMfaRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  // Enroll factor (legacy path — not tied to user management users)
  app.post('/auth/factors/enroll', async (c) => {
    const body = await parseJsonBody(c);
    const type = (body.type as string) ?? 'totp';
    const issuer = (body.totp_issuer as string) ?? 'WorkOS Emulator';
    const totpUser = (body.totp_user as string) ?? 'legacy@emulator';
    const secret = randomBytes(20).toString('hex').slice(0, 32).toUpperCase();
    const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(totpUser)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

    const factor = ws.authFactors.insert({
      object: 'authentication_factor',
      user_id: 'legacy',
      type: type as 'totp',
      totp: { issuer, user: totpUser, uri },
    });

    return c.json(formatAuthFactor(factor), 201);
  });

  // Get factor
  app.get('/auth/factors/:id', (c) => {
    const factor = ws.authFactors.get(c.req.param('id'));
    if (!factor) throw notFound('AuthenticationFactor');
    return c.json(formatAuthFactor(factor));
  });

  // Delete factor
  app.delete('/auth/factors/:id', (c) => {
    const factor = ws.authFactors.get(c.req.param('id'));
    if (!factor) throw notFound('AuthenticationFactor');
    ws.authFactors.delete(factor.id);
    return c.body(null, 204);
  });

  // Create challenge
  app.post('/auth/factors/:id/challenge', async (c) => {
    const factor = ws.authFactors.get(c.req.param('id'));
    if (!factor) throw notFound('AuthenticationFactor');

    const code = generateCode();
    const challenge = ws.authChallenges.insert({
      object: 'authentication_challenge',
      user_id: factor.user_id,
      factor_id: factor.id,
      expires_at: expiresIn(10),
      code,
    });

    return c.json(formatAuthChallenge(challenge), 201);
  });

  // Verify challenge
  app.post('/auth/challenges/:id/verify', async (c) => {
    const challenge = ws.authChallenges.get(c.req.param('id'));
    if (!challenge) throw notFound('AuthenticationChallenge');

    if (isExpired(challenge.expires_at)) {
      ws.authChallenges.delete(challenge.id);
      throw new WorkOSApiError(400, 'Challenge has expired', 'expired_challenge');
    }

    const body = await parseJsonBody(c);
    const code = body.code as string;
    if (!code) {
      throw new WorkOSApiError(400, 'code is required', 'invalid_request');
    }
    if (challenge.code && code !== challenge.code) {
      throw new WorkOSApiError(400, 'Invalid one-time code', 'invalid_one_time_code');
    }

    ws.authChallenges.delete(challenge.id);
    return c.json({ challenge: formatAuthChallenge(challenge), valid: true });
  });
}
