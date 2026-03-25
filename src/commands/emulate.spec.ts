import { describe, it, expect, afterEach } from 'vitest';
import { createEmulator, type Emulator } from '../emulate/index.js';

describe('createEmulator', () => {
  let emulator: Emulator | undefined;

  afterEach(async () => {
    if (emulator) {
      await emulator.close();
      emulator = undefined;
    }
  });

  it('starts on random port and serves health check', async () => {
    emulator = await createEmulator({ port: 0 });
    expect(emulator.port).toBeGreaterThan(0);
    expect(emulator.url).toContain(`localhost:${emulator.port}`);

    const res = await fetch(`${emulator.url}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('accepts API key and returns user list', async () => {
    emulator = await createEmulator({ port: 0 });

    const res = await fetch(`${emulator.url}/user_management/users`, {
      headers: { Authorization: 'Bearer sk_test_default' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object).toBe('list');
    expect(body.data).toEqual([]);
  });

  it('rejects missing API key', async () => {
    emulator = await createEmulator({ port: 0 });

    const res = await fetch(`${emulator.url}/user_management/users`);
    expect(res.status).toBe(401);
  });

  it('seeds users from config', async () => {
    emulator = await createEmulator({
      port: 0,
      seed: {
        users: [{ email: 'seeded@test.com', first_name: 'Seeded' }],
      },
    });

    const res = await fetch(`${emulator.url}/user_management/users`, {
      headers: { Authorization: 'Bearer sk_test_default' },
    });
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].email).toBe('seeded@test.com');
  });

  it('reset() clears and re-seeds data', async () => {
    emulator = await createEmulator({
      port: 0,
      seed: {
        users: [{ email: 'reset@test.com' }],
      },
    });

    // Create an extra user
    await fetch(`${emulator.url}/user_management/users`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sk_test_default',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'extra@test.com' }),
    });

    const before = (await (
      await fetch(`${emulator.url}/user_management/users`, {
        headers: { Authorization: 'Bearer sk_test_default' },
      })
    ).json()) as any;
    expect(before.data).toHaveLength(2);

    emulator.reset();

    const after = (await (
      await fetch(`${emulator.url}/user_management/users`, {
        headers: { Authorization: 'Bearer sk_test_default' },
      })
    ).json()) as any;
    expect(after.data).toHaveLength(1);
    expect(after.data[0].email).toBe('reset@test.com');
  });

  it('supports custom API keys', async () => {
    emulator = await createEmulator({
      port: 0,
      seed: {
        apiKeys: { sk_test_custom: { environment: 'staging' } },
      },
    });

    // Default key should not work
    const res1 = await fetch(`${emulator.url}/user_management/users`, {
      headers: { Authorization: 'Bearer sk_test_default' },
    });
    expect(res1.status).toBe(401);

    // Custom key should work
    const res2 = await fetch(`${emulator.url}/user_management/users`, {
      headers: { Authorization: 'Bearer sk_test_custom' },
    });
    expect(res2.status).toBe(200);
  });

  it('exposes the primary API key on the emulator object', async () => {
    emulator = await createEmulator({ port: 0 });
    expect(emulator.apiKey).toBe('sk_test_default');
  });

  it('exposes custom API key when seed.apiKeys is provided', async () => {
    emulator = await createEmulator({
      port: 0,
      seed: { apiKeys: { sk_test_custom: { environment: 'staging' } } },
    });
    expect(emulator.apiKey).toBe('sk_test_custom');
  });

  it('issues JWT tokens with correct issuer when using port 0', async () => {
    emulator = await createEmulator({
      port: 0,
      seed: { users: [{ email: 'jwt@test.com', password: 'pass' }] },
    });

    const res = await fetch(`${emulator.url}/user_management/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'password', email: 'jwt@test.com', password: 'pass' }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    const payload = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString('utf-8'));
    expect(payload.iss).toBe(emulator.url);
  });
});
