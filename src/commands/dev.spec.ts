import { describe, it, expect } from 'vitest';
import { buildDevEnv } from './dev.js';

describe('buildDevEnv', () => {
  it('includes WORKOS_API_BASE_URL pointing at emulator', () => {
    const env = buildDevEnv('http://localhost:4100');
    expect(env.WORKOS_API_BASE_URL).toBe('http://localhost:4100');
  });

  it('includes decomposed SDK env vars', () => {
    const env = buildDevEnv('http://localhost:4100');
    expect(env.WORKOS_API_HOSTNAME).toBe('localhost');
    expect(env.WORKOS_API_PORT).toBe('4100');
    expect(env.WORKOS_API_HTTPS).toBe('false');
  });

  it('includes WORKOS_API_KEY with test default key', () => {
    const env = buildDevEnv('http://localhost:4100');
    expect(env.WORKOS_API_KEY).toBe('sk_test_default');
  });

  it('uses custom API key when provided', () => {
    const env = buildDevEnv('http://localhost:4100', 'sk_test_custom');
    expect(env.WORKOS_API_KEY).toBe('sk_test_custom');
  });

  it('includes WORKOS_CLIENT_ID', () => {
    const env = buildDevEnv('http://localhost:4100');
    expect(env.WORKOS_CLIENT_ID).toBe('client_emulated');
  });

  it('uses the provided emulator URL and parses port correctly', () => {
    const env = buildDevEnv('http://localhost:9999');
    expect(env.WORKOS_API_BASE_URL).toBe('http://localhost:9999');
    expect(env.WORKOS_API_PORT).toBe('9999');
  });

  it('returns all expected keys', () => {
    const env = buildDevEnv('http://localhost:4100');
    expect(Object.keys(env).sort()).toEqual([
      'WORKOS_API_BASE_URL',
      'WORKOS_API_HOSTNAME',
      'WORKOS_API_HTTPS',
      'WORKOS_API_KEY',
      'WORKOS_API_PORT',
      'WORKOS_CLIENT_ID',
    ]);
  });
});
