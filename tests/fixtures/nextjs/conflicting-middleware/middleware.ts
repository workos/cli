import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Simple in-memory rate limiting (for demo purposes)
const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100;
const WINDOW_MS = 60 * 1000; // 1 minute

function getRateLimitInfo(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = requestCounts.get(ip);

  if (!record || now > record.resetTime) {
    requestCounts.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  if (record.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT - record.count };
}

export function middleware(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const { allowed, remaining } = getRateLimitInfo(ip);

  // Log request for monitoring
  console.log(`[${new Date().toISOString()}] ${request.method} ${request.nextUrl.pathname} from ${ip}`);

  // Rate limit check
  if (!allowed) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: {
        'Retry-After': '60',
        'X-RateLimit-Limit': String(RATE_LIMIT),
        'X-RateLimit-Remaining': '0',
      },
    });
  }

  const response = NextResponse.next();

  // Add custom security headers
  response.headers.set('X-App-Version', '1.0.0');
  response.headers.set('X-Request-Id', crypto.randomUUID());
  response.headers.set('X-RateLimit-Limit', String(RATE_LIMIT));
  response.headers.set('X-RateLimit-Remaining', String(remaining));

  return response;
}

export const config = {
  matcher: ['/api/:path*', '/dashboard/:path*'],
};
