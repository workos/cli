import { type RouteContext, parseJsonBody, WorkOSApiError } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { assertLocalRedirectUri, generateVerificationToken, expiresIn, isExpired } from '../helpers.js';

export function dataIntegrationRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  // Authorize (public endpoint — no auth required)
  app.get('/data-integrations/:slug/authorize', (c) => {
    const slug = c.req.param('slug');
    const url = new URL(c.req.url);
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state') ?? null;

    if (!redirectUri) {
      throw new WorkOSApiError(400, 'redirect_uri is required', 'invalid_request');
    }
    assertLocalRedirectUri(redirectUri);

    const code = generateVerificationToken();
    ws.dataIntegrationAuths.insert({
      slug,
      code,
      redirect_uri: redirectUri,
      state,
      expires_at: expiresIn(10),
    });

    const redirect = new URL(redirectUri);
    redirect.searchParams.set('code', code);
    if (state) redirect.searchParams.set('state', state);

    return c.redirect(redirect.toString(), 302);
  });

  // Exchange code for token
  app.post('/data-integrations/:slug/token', async (c) => {
    const slug = c.req.param('slug');
    const body = await parseJsonBody(c);
    const code = body.code as string | undefined;

    if (!code) {
      throw new WorkOSApiError(400, 'code is required', 'invalid_request');
    }

    const auth = ws.dataIntegrationAuths.findOneBy('code', code);
    if (!auth || auth.slug !== slug) {
      throw new WorkOSApiError(400, 'Invalid authorization code', 'invalid_grant');
    }

    if (isExpired(auth.expires_at)) {
      ws.dataIntegrationAuths.delete(auth.id);
      throw new WorkOSApiError(400, 'Authorization code has expired', 'invalid_grant');
    }

    ws.dataIntegrationAuths.delete(auth.id);

    return c.json({
      access_token: `di_mock_${slug}_${generateVerificationToken().slice(0, 8)}`,
      token_type: 'bearer',
      expires_in: 3600,
    });
  });
}
