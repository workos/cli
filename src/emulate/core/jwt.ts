import { createSign, createVerify, generateKeyPairSync, type KeyObject } from 'node:crypto';

export interface JWTPayload {
  sub: string;
  sid?: string;
  org_id?: string;
  role?: string;
  permissions?: string[];
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

interface SignOptions {
  expiresIn?: number;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64url');
}

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

export class JWTManager {
  private privateKey: KeyObject;
  private publicKey: KeyObject;
  private kid: string;
  issuer: string;

  constructor(issuer = 'https://api.workos.com') {
    this.issuer = issuer;
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.kid = `workos_emulate_${Date.now()}`;
  }

  sign(payload: Omit<JWTPayload, 'iss' | 'iat' | 'exp'>, options?: SignOptions): string {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = options?.expiresIn ?? 3600;

    const fullPayload: JWTPayload = {
      ...payload,
      iss: this.issuer,
      iat: now,
      exp: now + expiresIn,
    };

    const header = { alg: 'RS256', typ: 'JWT', kid: this.kid };
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(fullPayload));
    const signingInput = `${headerB64}.${payloadB64}`;

    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    const signature = signer.sign(this.privateKey, 'base64url');

    return `${signingInput}.${signature}`;
  }

  verify(token: string): JWTPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const [headerB64, payloadB64, signature] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;

    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingInput);
    const valid = verifier.verify(this.publicKey, signature, 'base64url');

    if (!valid) {
      throw new Error('Invalid token signature');
    }

    const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf-8')) as JWTPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error('Token has expired');
    }

    return payload;
  }

  getJWKS(): { keys: Record<string, unknown>[] } {
    const jwk = this.publicKey.export({ format: 'jwk' });
    return {
      keys: [
        {
          ...jwk,
          kid: this.kid,
          alg: 'RS256',
          use: 'sig',
        },
      ],
    };
  }

  getPublicKeyPem(): string {
    return this.publicKey.export({ type: 'spki', format: 'pem' }) as string;
  }
}
