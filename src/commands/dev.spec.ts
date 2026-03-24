import { describe, it, expect } from 'vitest';
import { buildDevEnv } from './dev.js';

describe('buildDevEnv', () => {
  it('includes WORKOS_API_BASE_URL pointing at emulator', () => {
    const env = buildDevEnv('http://localhost:4100');
    expect(env.WORKOS_API_BASE_URL).toBe('http://localhost:4100');
  });

  it('includes WORKOS_API_KEY with test default key', () => {
    const env = buildDevEnv('http://localhost:4100');
    expect(env.WORKOS_API_KEY).toBe('sk_test_default');
  });

  it('includes WORKOS_CLIENT_ID', () => {
    const env = buildDevEnv('http://localhost:4100');
    expect(env.WORKOS_CLIENT_ID).toBe('client_emulated');
  });

  it('uses the provided emulator URL', () => {
    const env = buildDevEnv('http://localhost:9999');
    expect(env.WORKOS_API_BASE_URL).toBe('http://localhost:9999');
  });

  it('returns exactly three keys', () => {
    const env = buildDevEnv('http://localhost:4100');
    expect(Object.keys(env)).toHaveLength(3);
    expect(Object.keys(env).sort()).toEqual(['WORKOS_API_BASE_URL', 'WORKOS_API_KEY', 'WORKOS_CLIENT_ID']);
  });
});
