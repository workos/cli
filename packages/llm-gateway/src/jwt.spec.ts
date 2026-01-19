import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as jose from 'jose';

// Mock env module
vi.mock('./env.js', () => ({
  env: {
    WORKOS_CLIENT_ID: 'client_test_123',
  },
}));

// Mock jose module
vi.mock('jose', async (importOriginal) => {
  const original = await importOriginal<typeof import('jose')>();
  return {
    ...original,
    createRemoteJWKSet: vi.fn(),
  };
});

// Import after mock setup
const { validateJWT, clearJWKSCache } = await import('./jwt.js');

describe('jwt', () => {
  beforeEach(() => {
    clearJWKSCache();
    vi.clearAllMocks();
  });

  describe('validateJWT', () => {
    it('returns valid result for valid JWT', async () => {
      const mockPayload = {
        sub: 'user_123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        iss: 'https://api.workos.com',
      };

      // Mock jwtVerify to return success
      vi.spyOn(jose, 'jwtVerify').mockResolvedValue({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as jose.JWTVerifyResult & jose.ResolvedKey);

      const result = await validateJWT('valid.jwt.token');

      expect(result.valid).toBe(true);
      expect(result.payload?.sub).toBe('user_123');
      expect(result.error).toBeUndefined();
    });

    it('returns error for expired JWT', async () => {
      const error = new Error('JWT expired');
      (error as unknown as { code: string }).code = 'ERR_JWT_EXPIRED';

      vi.spyOn(jose, 'jwtVerify').mockRejectedValue(error);

      const result = await validateJWT('expired.jwt.token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token expired');
    });

    it('returns error for invalid signature', async () => {
      const error = new Error('Invalid signature');
      (error as unknown as { code: string }).code = 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED';

      vi.spyOn(jose, 'jwtVerify').mockRejectedValue(error);

      const result = await validateJWT('invalid.signature.token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token signature');
    });

    it('returns error for malformed JWT', async () => {
      const error = new Error('Malformed JWT');
      (error as unknown as { code: string }).code = 'ERR_JWS_INVALID';

      vi.spyOn(jose, 'jwtVerify').mockRejectedValue(error);

      const result = await validateJWT('malformed-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    it('retries JWKS fetch on unknown key ID and succeeds', async () => {
      const mockPayload = {
        sub: 'user_456',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        iss: 'https://api.workos.com',
      };

      const unknownKeyError = new Error('No matching key');
      (unknownKeyError as unknown as { code: string }).code = 'ERR_JWKS_NO_MATCHING_KEY';

      let callCount = 0;
      vi.spyOn(jose, 'jwtVerify').mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(unknownKeyError);
        }
        return Promise.resolve({
          payload: mockPayload,
          protectedHeader: { alg: 'RS256' },
        } as jose.JWTVerifyResult & jose.ResolvedKey);
      });

      const result = await validateJWT('token.with.new.key');

      expect(result.valid).toBe(true);
      expect(result.payload?.sub).toBe('user_456');
      expect(callCount).toBe(2);
    });

    it('returns error when JWKS refresh fails', async () => {
      const unknownKeyError = new Error('No matching key');
      (unknownKeyError as unknown as { code: string }).code = 'ERR_JWKS_NO_MATCHING_KEY';

      vi.spyOn(jose, 'jwtVerify').mockRejectedValue(unknownKeyError);

      const result = await validateJWT('token.with.unknown.key');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    it('uses cached JWKS for subsequent calls', async () => {
      const mockPayload = {
        sub: 'user_789',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        iss: 'https://api.workos.com',
      };

      const createRemoteJWKSetSpy = vi.spyOn(jose, 'createRemoteJWKSet');
      vi.spyOn(jose, 'jwtVerify').mockResolvedValue({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as jose.JWTVerifyResult & jose.ResolvedKey);

      // First call - should create JWKS
      await validateJWT('first.token');

      // Second call - should use cache
      await validateJWT('second.token');

      // createRemoteJWKSet should only be called once (cached)
      expect(createRemoteJWKSetSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearJWKSCache', () => {
    it('clears the cache so next call fetches fresh JWKS', async () => {
      const mockPayload = {
        sub: 'user_abc',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        iss: 'https://api.workos.com',
      };

      const createRemoteJWKSetSpy = vi.spyOn(jose, 'createRemoteJWKSet');
      vi.spyOn(jose, 'jwtVerify').mockResolvedValue({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      } as jose.JWTVerifyResult & jose.ResolvedKey);

      // First call - creates cache
      await validateJWT('token1');
      expect(createRemoteJWKSetSpy).toHaveBeenCalledTimes(1);

      // Clear cache
      clearJWKSCache();

      // Next call should fetch fresh JWKS
      await validateJWT('token2');
      expect(createRemoteJWKSetSpy).toHaveBeenCalledTimes(2);
    });
  });
});
