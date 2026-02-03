// Custom server middleware for React Router
// This file contains middleware logic that should be preserved when adding AuthKit

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();
const RATE_LIMIT = 100;
const WINDOW_MS = 60 * 1000;

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  if (record.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT - record.count };
}

export function logRequest(method: string, path: string, ip: string): void {
  console.log(`[${new Date().toISOString()}] ${method} ${path} from ${ip}`);
}

export function addSecurityHeaders(headers: Headers): Headers {
  headers.set('X-App-Version', '1.0.0');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-XSS-Protection', '1; mode=block');
  return headers;
}

export interface MiddlewareContext {
  ip: string;
  method: string;
  path: string;
}

export async function runMiddleware(ctx: MiddlewareContext): Promise<Response | null> {
  const { ip, method, path } = ctx;

  // Log all requests
  logRequest(method, path, ip);

  // Check rate limit for API routes
  if (path.startsWith('/api')) {
    const { allowed } = checkRateLimit(ip);
    if (!allowed) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }
  }

  // Return null to continue to the route handler
  return null;
}
