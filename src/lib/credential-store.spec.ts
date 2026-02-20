import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { existsSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock debug utilities BEFORE anything that imports credential-store
vi.mock('../utils/debug.js', () => ({
  logWarn: vi.fn(),
}));

// Create a mock home directory for all tests
let testDir: string;
let installerDir: string;
let credentialsFile: string;

// Mock keyring storage
const mockKeyring = new Map<string, string>();

// Track whether keyring is "available" for this test
let keyringAvailable = true;

// Mock @napi-rs/keyring BEFORE importing credential-store
vi.mock('@napi-rs/keyring', () => ({
  Entry: class MockEntry {
    private key: string;

    constructor(
      private service: string,
      private account: string,
    ) {
      this.key = `${service}:${account}`;
    }

    getPassword(): string | null {
      if (!keyringAvailable && this.account !== '__probe__') {
        throw new Error('Keyring not available');
      }
      return mockKeyring.get(this.key) ?? null;
    }

    setPassword(password: string): void {
      if (!keyringAvailable) {
        throw new Error('Keyring not available');
      }
      mockKeyring.set(this.key, password);
    }

    deletePassword(): void {
      if (!keyringAvailable && mockKeyring.has(this.key)) {
        throw new Error('Keyring not available');
      }
      mockKeyring.delete(this.key);
    }
  },
}));

// Mock os.homedir BEFORE importing credential-store module
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    default: {
      ...original,
      homedir: () => testDir,
    },
    homedir: () => testDir,
  };
});

// Now import credential-store module (after mocks are set up)
const {
  hasCredentials,
  getCredentials,
  saveCredentials,
  clearCredentials,
  setInsecureStorage,
  updateTokens,
  getCredentialsPath,
} = await import('./credential-store.js');
import type { Credentials } from './credential-store.js';

describe('credential-store', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'cred-store-test-'));
    installerDir = join(testDir, '.workos');
    credentialsFile = join(installerDir, 'credentials.json');

    // Reset state
    mockKeyring.clear();
    keyringAvailable = true;
    setInsecureStorage(false);
  });

  afterEach(() => {
    // Clean up
    if (existsSync(credentialsFile)) {
      unlinkSync(credentialsFile);
    }
    if (existsSync(installerDir)) {
      rmdirSync(installerDir);
    }
    if (existsSync(testDir)) {
      rmdirSync(testDir);
    }
  });

  const validCreds: Credentials = {
    accessToken: 'token123',
    expiresAt: Date.now() + 3600000,
    userId: 'user_abc',
    email: 'test@example.com',
  };

  describe('keyring storage (default)', () => {
    it('saves credentials to keyring', () => {
      saveCredentials(validCreds);
      expect(mockKeyring.has('workos-cli:credentials')).toBe(true);
    });

    it('retrieves credentials from keyring', () => {
      saveCredentials(validCreds);
      const creds = getCredentials();
      expect(creds?.accessToken).toBe(validCreds.accessToken);
      expect(creds?.userId).toBe(validCreds.userId);
    });

    it('keeps file as durable fallback alongside keyring', () => {
      saveCredentials(validCreds);

      // Both keyring and file should have credentials
      expect(mockKeyring.has('workos-cli:credentials')).toBe(true);
      expect(existsSync(credentialsFile)).toBe(true);
    });

    it('clears from both keyring and file', () => {
      // Save to keyring
      saveCredentials(validCreds);

      // Also create a file manually
      mkdirSync(installerDir, { recursive: true });
      writeFileSync(credentialsFile, JSON.stringify(validCreds));

      clearCredentials();

      expect(mockKeyring.has('workos-cli:credentials')).toBe(false);
      expect(existsSync(credentialsFile)).toBe(false);
    });

    it('hasCredentials returns true when in keyring', () => {
      saveCredentials(validCreds);
      expect(hasCredentials()).toBe(true);
    });
  });

  describe('file fallback (keyring unavailable)', () => {
    beforeEach(() => {
      keyringAvailable = false;
    });

    it('falls back to file storage when keyring unavailable', () => {
      // Suppress console.warn for this test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      saveCredentials(validCreds);

      expect(existsSync(credentialsFile)).toBe(true);
      expect(mockKeyring.has('workos-cli:credentials')).toBe(false);

      warnSpy.mockRestore();
    });

    it('reads from file when keyring unavailable', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      saveCredentials(validCreds);
      const creds = getCredentials();

      expect(creds?.accessToken).toBe(validCreds.accessToken);

      warnSpy.mockRestore();
    });
  });

  describe('migration (file to keyring)', () => {
    it('migrates file credentials to keyring on read but keeps file', () => {
      // Create file credentials directly
      mkdirSync(installerDir, { recursive: true });
      writeFileSync(credentialsFile, JSON.stringify(validCreds));

      // Read should migrate to keyring AND keep the file
      const creds = getCredentials();

      expect(creds?.accessToken).toBe(validCreds.accessToken);
      expect(mockKeyring.has('workos-cli:credentials')).toBe(true);
      expect(existsSync(credentialsFile)).toBe(true);
    });

    it('keeps file if keyring unavailable during migration', () => {
      // Create file credentials
      mkdirSync(installerDir, { recursive: true });
      writeFileSync(credentialsFile, JSON.stringify(validCreds));

      // Make keyring unavailable
      keyringAvailable = false;

      // Read should return file creds without migrating
      const creds = getCredentials();

      expect(creds?.accessToken).toBe(validCreds.accessToken);
      expect(existsSync(credentialsFile)).toBe(true);
    });
  });

  describe('--insecure-storage flag', () => {
    it('uses file storage when flag is set', () => {
      setInsecureStorage(true);
      saveCredentials(validCreds);

      expect(existsSync(credentialsFile)).toBe(true);
      expect(mockKeyring.has('workos-cli:credentials')).toBe(false);
    });

    it('reads only from file when flag is set', () => {
      // Save to keyring first (before flag)
      saveCredentials(validCreds);
      expect(mockKeyring.has('workos-cli:credentials')).toBe(true);

      // Now enable insecure storage and save different creds
      setInsecureStorage(true);
      const fileCreds: Credentials = { ...validCreds, userId: 'file_user' };
      saveCredentials(fileCreds);

      // Should read from file, not keyring
      const creds = getCredentials();
      expect(creds?.userId).toBe('file_user');
    });

    it('hasCredentials only checks file when flag is set', () => {
      // Save with default mode (writes to both keyring + file)
      saveCredentials(validCreds);

      // Enable insecure storage — should still find the file
      setInsecureStorage(true);
      expect(hasCredentials()).toBe(true);
    });
  });

  describe('updateTokens', () => {
    it('updates tokens in keyring storage', () => {
      saveCredentials(validCreds);

      updateTokens('new_access_token', Date.now() + 7200000, 'new_refresh');

      const creds = getCredentials();
      expect(creds?.accessToken).toBe('new_access_token');
      expect(creds?.refreshToken).toBe('new_refresh');
      // Original fields preserved
      expect(creds?.userId).toBe(validCreds.userId);
    });

    it('throws when no credentials exist', () => {
      expect(() => updateTokens('token', Date.now())).toThrow('No existing credentials to update');
    });
  });

  describe('getCredentialsPath', () => {
    it('returns path to credentials file', () => {
      const path = getCredentialsPath();
      expect(path).toContain('.workos');
      expect(path).toContain('credentials.json');
    });
  });
});
