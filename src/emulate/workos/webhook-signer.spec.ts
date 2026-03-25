import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { signWebhookPayload } from './webhook-signer.js';

describe('signWebhookPayload', () => {
  it('returns signature in t=...,v1=... format', () => {
    const sig = signWebhookPayload('{"test":true}', 'secret123');
    expect(sig).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
  });

  it('produces verifiable HMAC-SHA256 signature', () => {
    const payload = '{"event":"user.created"}';
    const secret = 'whsec_test_key';
    const sig = signWebhookPayload(payload, secret);

    const match = sig.match(/^t=(\d+),v1=([a-f0-9]+)$/);
    expect(match).toBeTruthy();

    const [, timestamp, hash] = match!;
    const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

    expect(hash).toBe(expected);
  });

  it('produces different signatures for different secrets', () => {
    const payload = '{"data":"same"}';
    const sig1 = signWebhookPayload(payload, 'secret_a');
    const sig2 = signWebhookPayload(payload, 'secret_b');

    const hash1 = sig1.split(',v1=')[1];
    const hash2 = sig2.split(',v1=')[1];
    expect(hash1).not.toBe(hash2);
  });
});
