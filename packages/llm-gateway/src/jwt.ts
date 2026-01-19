import * as jose from 'jose';
import { env } from './env.js';

interface JWKSCache {
  keys: jose.JWTVerifyGetKey;
  fetchedAt: number;
  clientId: string;
}

const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

let jwksCache: JWKSCache | null = null;

function getWorkOSJwksUrl(clientId: string): string {
  return `https://api.workos.com/sso/jwks/${clientId}`;
}

function getWorkOSIssuer(): string {
  return 'https://api.workos.com';
}

async function getJWKS(clientId: string): Promise<jose.JWTVerifyGetKey> {
  const now = Date.now();

  // Return cached JWKS if still valid and for same client
  if (jwksCache && jwksCache.clientId === clientId && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }

  // Fetch fresh JWKS
  const jwksUrl = getWorkOSJwksUrl(clientId);
  const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));

  jwksCache = {
    keys: JWKS,
    fetchedAt: now,
    clientId,
  };

  return JWKS;
}

export interface JWTPayload {
  sub: string; // User ID
  exp: number; // Expiration timestamp
  iat: number; // Issued at timestamp
  iss: string; // Issuer (WorkOS)
  aud?: string; // Audience (optional)
}

export interface ValidationResult {
  valid: boolean;
  payload?: JWTPayload;
  error?: string;
}

export async function validateJWT(token: string): Promise<ValidationResult> {
  const clientId = env.WORKOS_CLIENT_ID;

  if (!clientId) {
    console.error('[Auth] WORKOS_CLIENT_ID not configured');
    return { valid: false, error: 'Server misconfigured' };
  }

  const expectedIssuer = getWorkOSIssuer();

  // Decode token first to see what issuer it has (for debugging)
  try {
    const decoded = jose.decodeJwt(token);
    if (decoded.iss !== expectedIssuer) {
      console.log(`[Auth] Token issuer: "${decoded.iss}"`);
      console.log(`[Auth] Expected issuer: "${expectedIssuer}"`);
    }
  } catch {
    // Ignore decode errors, will be caught in verify
  }

  try {
    const JWKS = await getJWKS(clientId);

    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: expectedIssuer,
      // Don't validate audience - any authenticated user can access
    });

    return {
      valid: true,
      payload: payload as JWTPayload,
    };
  } catch (error: unknown) {
    const joseError = error as { code?: string; message?: string };

    // Log the actual error for debugging
    console.log(`[Auth] JWT error: ${joseError.code} - ${joseError.message}`);

    // Handle specific JWT errors
    if (joseError.code === 'ERR_JWT_EXPIRED') {
      return { valid: false, error: 'Token expired' };
    }
    if (joseError.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      return { valid: false, error: 'Invalid token signature' };
    }
    if (joseError.code === 'ERR_JWKS_NO_MATCHING_KEY') {
      // Unknown key ID - try refreshing JWKS
      jwksCache = null;
      try {
        const JWKS = await getJWKS(clientId);
        const { payload } = await jose.jwtVerify(token, JWKS, {
          issuer: expectedIssuer,
        });
        return { valid: true, payload: payload as JWTPayload };
      } catch {
        return { valid: false, error: 'Invalid token' };
      }
    }

    return { valid: false, error: 'Invalid token' };
  }
}

// Clear cache (useful for testing)
export function clearJWKSCache(): void {
  jwksCache = null;
}
