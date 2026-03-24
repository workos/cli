import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JWTManager } from './jwt.js';

describe('JWTManager', () => {
  let jwt: JWTManager;

  beforeEach(() => {
    jwt = new JWTManager('https://api.workos.test');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('signs a token and verifies it', () => {
    const token = jwt.sign({
      sub: 'user_01ABC',
      aud: 'client_01XYZ',
      sid: 'session_01DEF',
      org_id: 'org_01GHI',
    });

    expect(token).toMatch(/^eyJ/);
    expect(token.split('.')).toHaveLength(3);

    const payload = jwt.verify(token);
    expect(payload.sub).toBe('user_01ABC');
    expect(payload.aud).toBe('client_01XYZ');
    expect(payload.sid).toBe('session_01DEF');
    expect(payload.org_id).toBe('org_01GHI');
    expect(payload.iss).toBe('https://api.workos.test');
    expect(payload.exp).toBe(payload.iat + 3600);
  });

  it('preserves optional fields like role and permissions', () => {
    const token = jwt.sign({
      sub: 'user_01ABC',
      aud: 'client_01XYZ',
      role: 'admin',
      permissions: ['read', 'write'],
    });

    const payload = jwt.verify(token);
    expect(payload.role).toBe('admin');
    expect(payload.permissions).toEqual(['read', 'write']);
  });

  it('supports custom expiration', () => {
    const token = jwt.sign({ sub: 'user_01ABC', aud: 'client_01XYZ' }, { expiresIn: 300 });
    const payload = jwt.verify(token);
    expect(payload.exp).toBe(payload.iat + 300);
  });

  it('throws on expired token', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));

    const token = jwt.sign({ sub: 'user_01ABC', aud: 'client_01XYZ' }, { expiresIn: 60 });

    vi.setSystemTime(new Date('2020-01-01T00:02:00Z'));
    expect(() => jwt.verify(token)).toThrow('Token has expired');
  });

  it('throws on tampered token', () => {
    const token = jwt.sign({ sub: 'user_01ABC', aud: 'client_01XYZ' });
    const parts = token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: 'hacker' })).toString('base64url');
    expect(() => jwt.verify(parts.join('.'))).toThrow('Invalid token signature');
  });

  it('a different JWTManager cannot verify the token', () => {
    const token = jwt.sign({ sub: 'user_01ABC', aud: 'client_01XYZ' });
    const otherJwt = new JWTManager();
    expect(() => otherJwt.verify(token)).toThrow('Invalid token signature');
  });

  it('returns JWKS with correct structure', () => {
    const jwks = jwt.getJWKS();
    expect(jwks.keys).toHaveLength(1);
    const key = jwks.keys[0];
    expect(key.kty).toBe('RSA');
    expect(key.alg).toBe('RS256');
    expect(key.use).toBe('sig');
    expect(key.kid).toBeDefined();
  });

  it('returns a PEM-encoded public key', () => {
    const pem = jwt.getPublicKeyPem();
    expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
  });
});
