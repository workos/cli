import { describe, it, expect } from 'vitest';
import * as keyring from '@napi-rs/keyring';

/**
 * Guardrail: the test suite must NEVER touch the real OS keychain.
 *
 * Credential helpers (clearCredentials/saveCredentials) operate on the live
 * `workos-cli` keychain entry regardless of file-fallback settings, so any
 * spec that exercises them would wipe a developer's real CLI login if the
 * keyring weren't mocked. The global setup file (src/test/setup.ts) swaps in
 * an in-memory keyring for every test. If that setup is ever removed, this
 * test fails loudly instead of silently logging developers out.
 */
describe('keyring test isolation', () => {
  it('replaces the real OS keychain with an in-memory mock during tests', () => {
    expect((keyring as Record<string, unknown>).__IS_TEST_MOCK__).toBe(true);
  });
});
