import type { Context, Next } from 'hono';
import { unauthorized } from './error-handler.js';

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
    if (!authHeader) throw unauthorized();

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token.startsWith('sk_')) throw unauthorized();

    const keyInfo = apiKeys[token];
    if (!keyInfo) throw unauthorized();

    c.set('auth', { environment: keyInfo.environment, apiKey: token } satisfies WorkOSAuthContext);
    await next();
  };
}
