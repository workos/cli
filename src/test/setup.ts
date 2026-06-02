import { vi } from 'vitest';

/**
 * Global test setup — runs before every spec file.
 *
 * Replaces @napi-rs/keyring with an in-memory implementation so the test
 * suite can NEVER touch the real OS keychain. clearCredentials() and
 * saveCredentials() operate on the live `workos-cli` keychain entry even when
 * file-fallback storage is forced, so an un-mocked spec would wipe a
 * developer's real CLI login (this happened — that's why this exists).
 *
 * Specs that need richer keyring behaviour (e.g. simulating an unavailable
 * keychain) still declare their own vi.mock('@napi-rs/keyring', ...); a
 * per-file mock overrides this global default. The __IS_TEST_MOCK__ sentinel
 * is asserted by src/test/keyring-isolation.spec.ts so removing this setup
 * fails CI instead of silently re-arming the footgun.
 */
vi.mock('@napi-rs/keyring', () => {
  const store = new Map<string, string>();
  return {
    __IS_TEST_MOCK__: true,
    Entry: class MockEntry {
      private key: string;

      constructor(service: string, account: string) {
        this.key = `${service}:${account}`;
      }

      getPassword(): string | null {
        return store.get(this.key) ?? null;
      }

      setPassword(password: string): void {
        store.set(this.key, password);
      }

      deletePassword(): void {
        store.delete(this.key);
      }
    },
  };
});
