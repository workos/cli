import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Store } from './store.js';
import { JWTManager } from './jwt.js';
import { createApiErrorHandler, requestIdMiddleware } from './middleware/error-handler.js';
import { authMiddleware, type ApiKeyMap, type WorkOSAppEnv } from './middleware/auth.js';
import type { ServicePlugin } from './plugin.js';

export interface ServerOptions {
  port?: number;
  baseUrl?: string;
  apiKeys?: ApiKeyMap;
}

export function createServer(plugin: ServicePlugin, options: ServerOptions = {}) {
  const port = options.port ?? 4100;
  const baseUrl = options.baseUrl ?? `http://localhost:${port}`;

  const app = new Hono<WorkOSAppEnv>();
  const store = new Store();
  const jwt = new JWTManager(baseUrl);

  const apiKeys: ApiKeyMap = options.apiKeys ?? {
    sk_test_default: { environment: 'test' },
  };

  app.onError(createApiErrorHandler());
  app.use('*', cors());
  app.use('*', requestIdMiddleware());

  // JWKS endpoint (public, no auth)
  app.get('/sso/jwks/:client_id', (c) => {
    return c.json(jwt.getJWKS());
  });

  // Auth middleware for API routes
  app.use('/api/*', authMiddleware(apiKeys));
  app.use('/user_management/*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    // Public endpoints (no auth required)
    if (
      path === '/user_management/authorize' ||
      path === '/user_management/authenticate' ||
      path === '/user_management/sessions/logout' ||
      path.startsWith('/user_management/sessions/jwks/')
    ) {
      return next();
    }
    return authMiddleware(apiKeys)(c, next);
  });
  app.use('/x/authkit/*', authMiddleware(apiKeys));
  app.use('/organizations', authMiddleware(apiKeys));
  app.use('/organizations/*', authMiddleware(apiKeys));
  app.use('/organization_memberships', authMiddleware(apiKeys));
  app.use('/organization_memberships/*', authMiddleware(apiKeys));
  app.use('/organization_domains', authMiddleware(apiKeys));
  app.use('/organization_domains/*', authMiddleware(apiKeys));
  app.use('/connections', authMiddleware(apiKeys));
  app.use('/connections/*', authMiddleware(apiKeys));
  app.use('/directories', authMiddleware(apiKeys));
  app.use('/directories/*', authMiddleware(apiKeys));
  app.use('/directory_groups', authMiddleware(apiKeys));
  app.use('/directory_groups/*', authMiddleware(apiKeys));
  app.use('/directory_users', authMiddleware(apiKeys));
  app.use('/directory_users/*', authMiddleware(apiKeys));
  app.use('/events', authMiddleware(apiKeys));
  app.use('/events/*', authMiddleware(apiKeys));
  app.use('/pipes/*', authMiddleware(apiKeys));
  app.use('/audit_logs/*', authMiddleware(apiKeys));
  app.use('/feature-flags', authMiddleware(apiKeys));
  app.use('/feature-flags/*', authMiddleware(apiKeys));
  app.use('/connect/*', authMiddleware(apiKeys));
  app.use('/data-integrations/*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.endsWith('/authorize')) return next();
    return authMiddleware(apiKeys)(c, next);
  });
  app.use('/radar/*', authMiddleware(apiKeys));
  app.use('/api_keys', authMiddleware(apiKeys));
  app.use('/api_keys/*', authMiddleware(apiKeys));
  app.use('/portal/*', authMiddleware(apiKeys));
  app.use('/webhook_endpoints', authMiddleware(apiKeys));
  app.use('/webhook_endpoints/*', authMiddleware(apiKeys));
  app.use('/auth/factors', authMiddleware(apiKeys));
  app.use('/auth/factors/*', authMiddleware(apiKeys));
  app.use('/auth/challenges/*', authMiddleware(apiKeys));

  // Rate limiting
  const rateLimitCounters = new Map<string, { remaining: number; resetAt: number }>();
  let lastPruneAt = Math.floor(Date.now() / 1000);

  app.use('*', async (c, next) => {
    const auth = c.get('auth');
    const key = auth?.apiKey ?? '__anonymous__';
    const now = Math.floor(Date.now() / 1000);

    if (now - lastPruneAt > 3600) {
      for (const [k, val] of rateLimitCounters) {
        if (val.resetAt <= now) rateLimitCounters.delete(k);
      }
      lastPruneAt = now;
    }

    let counter = rateLimitCounters.get(key);
    if (!counter || counter.resetAt <= now) {
      counter = { remaining: 1000, resetAt: now + 60 };
      rateLimitCounters.set(key, counter);
    }

    counter.remaining = Math.max(0, counter.remaining - 1);

    c.header('X-RateLimit-Limit', '1000');
    c.header('X-RateLimit-Remaining', String(counter.remaining));
    c.header('X-RateLimit-Reset', String(counter.resetAt));

    if (counter.remaining === 0) {
      c.header('Retry-After', String(counter.resetAt - now));
      return c.json(
        {
          message: 'Too Many Requests',
          code: 'rate_limit_exceeded',
        },
        429,
      );
    }

    await next();
  });

  // Store API key map for route access
  store.setData('apiKeyMap', apiKeys);

  // Register plugin routes
  plugin.register({ app, store, jwt, baseUrl });

  // Not found handler
  app.notFound((c) =>
    c.json(
      {
        message: 'Not Found',
        code: 'not_found',
      },
      404,
    ),
  );

  return { app, store, jwt, port, baseUrl };
}
