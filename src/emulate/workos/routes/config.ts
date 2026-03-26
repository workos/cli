import { type RouteContext, parseJsonBody, WorkOSApiError, validationError } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatRedirectUri, formatCorsOrigin } from '../helpers.js';
import { STORE_KEYS } from '../constants.js';

export function configRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.post('/user_management/redirect_uris', async (c) => {
    const body = await parseJsonBody(c);
    const uri = body.uri as string | undefined;
    if (!uri) {
      throw validationError('uri is required', [{ field: 'uri', code: 'required' }]);
    }

    const existing = ws.redirectUris.findOneBy('uri', uri);
    if (existing) {
      throw new WorkOSApiError(422, 'Redirect URI already exists', 'redirect_uri_already_exists');
    }

    const redirectUri = ws.redirectUris.insert({
      object: 'redirect_uri',
      uri,
    });

    return c.json(formatRedirectUri(redirectUri), 201);
  });

  app.post('/user_management/cors_origins', async (c) => {
    const body = await parseJsonBody(c);
    const origin = body.origin as string | undefined;
    if (!origin) {
      throw validationError('origin is required', [{ field: 'origin', code: 'required' }]);
    }

    const existing = ws.corsOrigins.findOneBy('origin', origin);
    if (existing) {
      throw new WorkOSApiError(422, 'CORS origin already exists', 'cors_origin_already_exists');
    }

    const corsOrigin = ws.corsOrigins.insert({
      object: 'cors_origin',
      origin,
    });

    return c.json(formatCorsOrigin(corsOrigin), 201);
  });

  app.get('/user_management/jwt_template', (c) => {
    const template = store.getData<Record<string, unknown>>(STORE_KEYS.jwtTemplate) ?? {
      object: 'jwt_template',
      custom_claims: {},
    };
    return c.json(template);
  });

  app.put('/user_management/jwt_template', async (c) => {
    const body = await parseJsonBody(c);
    const template = {
      object: 'jwt_template',
      custom_claims: (body.custom_claims as Record<string, unknown>) ?? {},
    };
    store.setData(STORE_KEYS.jwtTemplate, template);
    return c.json(template);
  });
}
