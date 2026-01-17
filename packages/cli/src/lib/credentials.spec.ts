import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  readFileSync,
  unlinkSync,
  mkdtempSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Create a mock home directory for all tests
let testDir: string;
let wizardDir: string;
let credentialsFile: string;

// Mock os.homedir BEFORE importing credentials module
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

// Now import credentials module (after mock is set up)
const {
  saveCredentials,
  getCredentials,
  clearCredentials,
  hasCredentials,
  isTokenExpired,
  getAccessToken,
  getCredentialsPath,
} = await import('./credentials.js');
import type { Credentials } from './credentials.js';

describe('credentials', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'credentials-test-'));
    wizardDir = join(testDir, '.wizard');
    credentialsFile = join(wizardDir, 'credentials.json');
  });

  afterEach(() => {
    // Clean up
    if (existsSync(credentialsFile)) {
      unlinkSync(credentialsFile);
    }
    if (existsSync(wizardDir)) {
      rmdirSync(wizardDir);
    }
    if (existsSync(testDir)) {
      rmdirSync(testDir);
    }
  });

  const validCreds: Credentials = {
    accessToken: 'access_token_123',
    refreshToken: 'refresh_token_456',
    expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
    userId: 'user_abc',
    email: 'test@example.com',
  };

  describe('getCredentialsPath', () => {
    it('returns path in .wizard directory', () => {
      const path = getCredentialsPath();
      expect(path).toContain('.wizard');
      expect(path).toContain('credentials.json');
    });
  });

  describe('saveCredentials', () => {
    it('creates .wizard directory if it does not exist', () => {
      saveCredentials(validCreds);
      expect(existsSync(wizardDir)).toBe(true);
    });

    it('creates credentials file', () => {
      saveCredentials(validCreds);
      expect(existsSync(credentialsFile)).toBe(true);
    });

    it('saves credentials as JSON', () => {
      saveCredentials(validCreds);
      const content = readFileSync(credentialsFile, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.accessToken).toBe(validCreds.accessToken);
      expect(parsed.refreshToken).toBe(validCreds.refreshToken);
      expect(parsed.userId).toBe(validCreds.userId);
      expect(parsed.email).toBe(validCreds.email);
    });

    it('creates file with 600 permissions', () => {
      saveCredentials(validCreds);
      const stats = statSync(credentialsFile);
      // 0o600 = 384 decimal, but we check the mode bits
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('creates directory with 700 permissions', () => {
      saveCredentials(validCreds);
      const stats = statSync(wizardDir);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o700);
    });
  });

  describe('hasCredentials', () => {
    it('returns false when file does not exist', () => {
      expect(hasCredentials()).toBe(false);
    });

    it('returns true when file exists', () => {
      saveCredentials(validCreds);
      expect(hasCredentials()).toBe(true);
    });
  });

  describe('getCredentials', () => {
    it('returns null when file does not exist', () => {
      expect(getCredentials()).toBeNull();
    });

    it('returns parsed credentials when file exists', () => {
      saveCredentials(validCreds);
      const creds = getCredentials();
      expect(creds).not.toBeNull();
      expect(creds?.accessToken).toBe(validCreds.accessToken);
      expect(creds?.email).toBe(validCreds.email);
    });

    it('returns null for corrupted file', () => {
      saveCredentials(validCreds);
      // Corrupt the file
      writeFileSync(credentialsFile, 'not valid json');
      expect(getCredentials()).toBeNull();
    });
  });

  describe('clearCredentials', () => {
    it('removes credentials file', () => {
      saveCredentials(validCreds);
      expect(hasCredentials()).toBe(true);
      clearCredentials();
      expect(hasCredentials()).toBe(false);
    });

    it('handles missing file gracefully', () => {
      expect(() => clearCredentials()).not.toThrow();
    });
  });

  describe('isTokenExpired', () => {
    it('returns false when token expires in more than 5 minutes', () => {
      const creds: Credentials = {
        ...validCreds,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes from now
      };
      expect(isTokenExpired(creds)).toBe(false);
    });

    it('returns true when token expires in less than 5 minutes', () => {
      const creds: Credentials = {
        ...validCreds,
        expiresAt: Date.now() + 2 * 60 * 1000, // 2 minutes from now
      };
      expect(isTokenExpired(creds)).toBe(true);
    });

    it('returns true when token is already expired', () => {
      const creds: Credentials = {
        ...validCreds,
        expiresAt: Date.now() - 1000, // 1 second ago
      };
      expect(isTokenExpired(creds)).toBe(true);
    });

    it('returns true when exactly at 5 minute boundary', () => {
      const creds: Credentials = {
        ...validCreds,
        expiresAt: Date.now() + 5 * 60 * 1000, // Exactly 5 minutes
      };
      expect(isTokenExpired(creds)).toBe(true);
    });
  });

  describe('getAccessToken', () => {
    it('returns null when no credentials exist', () => {
      expect(getAccessToken()).toBeNull();
    });

    it('returns token when credentials exist and not expired', () => {
      saveCredentials(validCreds);
      expect(getAccessToken()).toBe(validCreds.accessToken);
    });

    it('returns null when token is expired', () => {
      const expiredCreds: Credentials = {
        ...validCreds,
        expiresAt: Date.now() - 1000,
      };
      saveCredentials(expiredCreds);
      expect(getAccessToken()).toBeNull();
    });
  });
});
