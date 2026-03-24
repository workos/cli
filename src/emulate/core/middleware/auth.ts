import type { Context, Next } from 'hono';

export interface WorkOSAuthContext {
  environment: string;
  apiKey: string;
}

export type WorkOSAppEnv = {
  Variables: {
    auth?: WorkOSAuthContext;
    requestId?: string;
  };
};

export type ApiKeyMap = Record<string, { environment: string }>;

export function authMiddleware(apiKeys: ApiKeyMap) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json(
        {
          message: 'Unauthorized',
          code: 'unauthorized',
        },
        401,
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token.startsWith('sk_')) {
      return c.json(
        {
          message: 'Unauthorized',
          code: 'unauthorized',
        },
        401,
      );
    }

    const keyInfo = apiKeys[token];
    if (!keyInfo) {
      return c.json(
        {
          message: 'Unauthorized',
          code: 'unauthorized',
        },
        401,
      );
    }

    c.set('auth', { environment: keyInfo.environment, apiKey: token } satisfies WorkOSAuthContext);
    await next();
  };
}
