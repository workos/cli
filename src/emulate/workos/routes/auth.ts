import { createHash } from 'node:crypto';
import { type RouteContext, notFound, parseJsonBody, WorkOSApiError, generateId } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatUser, verifyPassword, isExpired, expiresIn } from '../helpers.js';

export function authRoutes(ctx: RouteContext): void {
  const { app, store, jwt } = ctx;
  const ws = getWorkOSStore(store);

  app.get('/user_management/authorize', (c) => {
    const url = new URL(c.req.url);
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    const codeChallenge = url.searchParams.get('code_challenge');
    const codeChallengeMethod = url.searchParams.get('code_challenge_method');

    if (!redirectUri) {
      throw new WorkOSApiError(400, 'redirect_uri is required', 'invalid_request');
    }

    const users = ws.users.all();
    const user = users[0];

    if (!user) {
      const redirect = new URL(redirectUri);
      redirect.searchParams.set('error', 'no_users');
      if (state) redirect.searchParams.set('state', state);
      return c.redirect(redirect.toString());
    }

    const authCode = ws.authCodes.insert({
      user_id: user.id,
      organization_id: null,
      code: generateId('auth_code'),
      redirect_uri: redirectUri,
      expires_at: expiresIn(10),
      code_challenge: codeChallenge ?? null,
      code_challenge_method: codeChallengeMethod ?? null,
    });

    const redirect = new URL(redirectUri);
    redirect.searchParams.set('code', authCode.code);
    if (state) redirect.searchParams.set('state', state);
    return c.redirect(redirect.toString());
  });

  app.post('/user_management/authenticate', async (c) => {
    const body = await parseJsonBody(c);
    const grantType = body.grant_type as string | undefined;
    const clientId = body.client_id as string | undefined;

    if (!grantType) {
      throw new WorkOSApiError(400, 'grant_type is required', 'invalid_request');
    }

    let user;
    let organizationId: string | null = null;
    let authMethod: string;

    switch (grantType) {
      case 'authorization_code': {
        const code = body.code as string;
        if (!code) throw new WorkOSApiError(400, 'code is required', 'invalid_request');

        const authCode = ws.authCodes.all().find((ac) => ac.code === code);
        if (!authCode) throw new WorkOSApiError(400, 'Invalid code', 'invalid_code');
        if (isExpired(authCode.expires_at)) {
          throw new WorkOSApiError(400, 'Code has expired', 'expired_code');
        }

        if (authCode.code_challenge) {
          const codeVerifier = body.code_verifier as string;
          if (!codeVerifier) {
            throw new WorkOSApiError(400, 'code_verifier is required', 'invalid_request');
          }
          const method = authCode.code_challenge_method ?? 'S256';
          let challenge: string;
          if (method === 'S256') {
            challenge = createHash('sha256').update(codeVerifier).digest('base64url');
          } else {
            challenge = codeVerifier;
          }
          if (challenge !== authCode.code_challenge) {
            throw new WorkOSApiError(400, 'Invalid code_verifier', 'invalid_code_verifier');
          }
        }

        user = ws.users.get(authCode.user_id);
        organizationId = authCode.organization_id;
        ws.authCodes.delete(authCode.id);
        authMethod = 'OAuth';
        break;
      }

      case 'password': {
        const email = body.email as string;
        const password = body.password as string;
        if (!email || !password) {
          throw new WorkOSApiError(400, 'email and password are required', 'invalid_request');
        }

        user = ws.users.findOneBy('email', email);
        if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
          throw new WorkOSApiError(401, 'Invalid credentials', 'invalid_credentials');
        }
        authMethod = 'Password';
        break;
      }

      case 'urn:workos:oauth:grant-type:magic-auth': {
        const code = body.code as string;
        const email = body.email as string;
        if (!code || !email) {
          throw new WorkOSApiError(400, 'code and email are required', 'invalid_request');
        }

        const magicAuth = ws.magicAuths.all().find((ma) => ma.code === code && ma.email === email);
        if (!magicAuth) {
          throw new WorkOSApiError(400, 'Invalid code', 'invalid_code');
        }
        if (isExpired(magicAuth.expires_at)) {
          throw new WorkOSApiError(400, 'Code has expired', 'expired_code');
        }

        user = ws.users.get(magicAuth.user_id);
        ws.magicAuths.delete(magicAuth.id);
        authMethod = 'MagicAuth';
        break;
      }

      case 'urn:workos:oauth:grant-type:email-verification': {
        const code = body.code as string;
        const userId = body.user_id as string;
        if (!code || !userId) {
          throw new WorkOSApiError(400, 'code and user_id are required', 'invalid_request');
        }

        const ev = ws.emailVerifications.findBy('user_id', userId).find((v) => v.code === code);
        if (!ev) {
          throw new WorkOSApiError(400, 'Invalid code', 'invalid_code');
        }
        if (isExpired(ev.expires_at)) {
          throw new WorkOSApiError(400, 'Code has expired', 'expired_code');
        }

        ws.users.update(userId, { email_verified: true });
        ws.emailVerifications.delete(ev.id);
        user = ws.users.get(userId);
        authMethod = 'EmailVerification';
        break;
      }

      default:
        throw new WorkOSApiError(400, `Unsupported grant_type: ${grantType}`, 'invalid_request');
    }

    if (!user) throw notFound('User');

    ws.users.update(user.id, { last_sign_in_at: new Date().toISOString() });
    const updatedUser = ws.users.get(user.id)!;

    const session = ws.sessions.insert({
      object: 'session',
      user_id: user.id,
      organization_id: organizationId,
      ip_address: c.req.header('x-forwarded-for') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    const accessToken = jwt.sign({
      sub: user.id,
      sid: session.id,
      org_id: organizationId ?? undefined,
      aud: clientId ?? 'workos-emulate',
    });

    const refreshToken = generateId('ref');

    return c.json({
      user: formatUser(updatedUser),
      organization_id: organizationId,
      access_token: accessToken,
      refresh_token: refreshToken,
      authentication_method: authMethod,
      sealed_session: null,
    });
  });
}
