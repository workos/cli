import { type RouteContext, notFound, parseJsonBody, WorkOSApiError } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatAuthChallenge, expiresIn, isExpired, generateCode } from '../helpers.js';

export function authChallengeRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.post('/user_management/auth_factors/:id/challenges', async (c) => {
    const factorId = c.req.param('id');
    const factor = ws.authFactors.get(factorId);
    if (!factor) throw notFound('AuthenticationFactor');

    const user = ws.users.get(factor.user_id);
    if (!user) throw notFound('User');

    // Emulator generates a code and stores it for verification
    const code = generateCode();

    const challenge = ws.authChallenges.insert({
      object: 'authentication_challenge',
      user_id: user.id,
      factor_id: factor.id,
      expires_at: expiresIn(10),
      code,
    });

    return c.json(formatAuthChallenge(challenge), 201);
  });

  app.post('/user_management/auth_challenges/:id/verify', async (c) => {
    const challengeId = c.req.param('id');
    const challenge = ws.authChallenges.get(challengeId);
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

    // In the emulator, accept the stored code or any 6-digit code for convenience
    if (challenge.code && code !== challenge.code) {
      throw new WorkOSApiError(400, 'Invalid one-time code', 'invalid_one_time_code');
    }

    ws.authChallenges.delete(challenge.id);

    return c.json({
      challenge: formatAuthChallenge(challenge),
      valid: true,
    });
  });
}
