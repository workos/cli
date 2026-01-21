import * as jose from 'jose';
import { env } from './env.js';

interface OIDCConfig {
  issuer: string;
  jwks_uri: string;
}

interface JWKSCache {
  keys: jose.JWTVerifyGetKey;
  issuer: string;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let oidcConfigCache: { config: OIDCConfig; fetchedAt: number } | null = null;
let jwksCache: JWKSCache | null = null;

/**
 * Fetch OIDC discovery document to get issuer and JWKS URI
 */
async function getOIDCConfig(): Promise<OIDCConfig> {
  const authkitDomain = env.WORKOS_AUTHKIT_DOMAIN;

  if (authkitDomain) {
    const now = Date.now();

    // Return cached config if still valid
    if (oidcConfigCache && now - oidcConfigCache.fetchedAt < CACHE_TTL_MS) {
      return oidcConfigCache.config;
    }

    // Fetch OIDC discovery document
    const discoveryUrl = `${authkitDomain}/.well-known/openid-configuration`;
    const response = await fetch(discoveryUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch OIDC config: ${response.status}`);
    }

    const config = await response.json() as OIDCConfig;
    oidcConfigCache = { config, fetchedAt: now };
    return config;
  }

  // Fallback to User Management (legacy)
  const clientId = env.WORKOS_CLIENT_ID;
  return {
    issuer: 'https://api.workos.com',
    jwks_uri: `https://api.workos.com/sso/jwks/${clientId}`,
  };
}

async function getJWKS(jwksUri: string, issuer: string): Promise<jose.JWTVerifyGetKey> {
  const now = Date.now();

  // Return cached JWKS if still valid and for same issuer
  if (jwksCache && jwksCache.issuer === issuer && now - jwksCache.fetchedAt < CACHE_TTL_MS) {
    return jwksCache.keys;
  }

  // Fetch fresh JWKS
  const JWKS = jose.createRemoteJWKSet(new URL(jwksUri));

  jwksCache = {
    keys: JWKS,
    issuer,
    fetchedAt: now,
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
  const authkitDomain = env.WORKOS_AUTHKIT_DOMAIN;
  const clientId = env.WORKOS_CLIENT_ID;

  if (!authkitDomain && !clientId) {
    console.error('[Auth] Neither WORKOS_AUTHKIT_DOMAIN nor WORKOS_CLIENT_ID configured');
    return { valid: false, error: 'Server misconfigured' };
  }

  try {
    // Get issuer and JWKS URI from OIDC discovery (or fallback)
    const oidcConfig = await getOIDCConfig();
    const { issuer, jwks_uri } = oidcConfig;

    // Decode token first to see what issuer it has (for debugging)
    try {
      const decoded = jose.decodeJwt(token);
      if (decoded.iss !== issuer) {
        console.log(`[Auth] Token issuer: "${decoded.iss}"`);
        console.log(`[Auth] Expected issuer: "${issuer}"`);
      }
    } catch {
      // Ignore decode errors, will be caught in verify
    }

    const JWKS = await getJWKS(jwks_uri, issuer);

    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer,
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
      oidcConfigCache = null;
      try {
        const oidcConfig = await getOIDCConfig();
        const JWKS = await getJWKS(oidcConfig.jwks_uri, oidcConfig.issuer);
        const { payload } = await jose.jwtVerify(token, JWKS, {
          issuer: oidcConfig.issuer,
        });
        return { valid: true, payload: payload as JWTPayload };
      } catch {
        return { valid: false, error: 'Invalid token' };
      }
    }

    return { valid: false, error: 'Invalid token' };
  }
}

// Clear caches (useful for testing)
export function clearJWKSCache(): void {
  jwksCache = null;
  oidcConfigCache = null;
}
