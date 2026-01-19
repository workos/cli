import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  unlinkSync,
  mkdtempSync,
  rmdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Credentials } from './credentials.js';

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

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  debug: vi.fn(),
  logToFile: vi.fn(),
}));

// Import after mocks are set up
const { saveCredentials, clearCredentials } = await import('./credentials.js');
const { ensureValidToken } = await import('./token-refresh.js');

describe('token-refresh', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'token-refresh-test-'));
    wizardDir = join(testDir, '.wizard');
    credentialsFile = join(wizardDir, 'credentials.json');
    vi.clearAllMocks();
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
    expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
    userId: 'user_abc',
    email: 'test@example.com',
  };

  const expiredCreds: Credentials = {
    ...validCreds,
    expiresAt: Date.now() - 1000, // 1 second ago
  };

  describe('ensureValidToken', () => {
    it('returns success for non-expired token', async () => {
      saveCredentials(validCreds);

      const result = await ensureValidToken();

      expect(result.success).toBe(true);
      expect(result.credentials?.accessToken).toBe(validCreds.accessToken);
    });

    it('returns error when no credentials exist', async () => {
      const result = await ensureValidToken();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not authenticated');
    });

    it('returns error when token is expired', async () => {
      saveCredentials(expiredCreds);

      const result = await ensureValidToken();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Session expired');
      expect(result.error).toContain('wizard login');
    });

    it('preserves credentials on valid token', async () => {
      saveCredentials(validCreds);

      const result = await ensureValidToken();

      expect(result.success).toBe(true);
      expect(result.credentials?.userId).toBe('user_abc');
      expect(result.credentials?.email).toBe('test@example.com');
    });
  });
});
