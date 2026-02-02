// Custom server middleware for TanStack Start
// This file contains middleware logic that should be preserved when adding AuthKit

import { createServerFn } from '@tanstack/react-start';

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

export interface SecurityContext {
  ip: string;
  userAgent: string;
  timestamp: number;
}

export const getSecurityContext = createServerFn({ method: 'GET' }).handler(async (): Promise<SecurityContext> => {
  // In a real app, this would get request headers from the server context
  return {
    ip: 'server-rendered',
    userAgent: 'server',
    timestamp: Date.now(),
  };
});

export const validateRequest = createServerFn({ method: 'POST' })
  .validator((data: { ip: string; path: string }) => data)
  .handler(async ({ data }): Promise<{ valid: boolean; error?: string }> => {
    const { ip, path } = data;

    // Log the request
    logRequest('POST', path, ip);

    // Check rate limit
    const { allowed } = checkRateLimit(ip);
    if (!allowed) {
      return { valid: false, error: 'Rate limit exceeded' };
    }

    return { valid: true };
  });

export const getServerHeaders = (): Record<string, string> => {
  return {
    'X-App-Version': '1.0.0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
  };
};
