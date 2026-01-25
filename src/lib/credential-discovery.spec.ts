import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkForEnvFiles, discoverCredentials, isValidClientId, isValidApiKey } from './credential-discovery.js';

describe('credential-discovery', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'cred-discovery-test-'));
  });

  afterEach(() => {
    try {
      const files = ['.env', '.env.local', '.env.development', '.env.development.local'];
      for (const f of files) {
        try {
          unlinkSync(join(testDir, f));
        } catch {
          // noop
        }
      }
      rmdirSync(testDir);
    } catch {
      // noop
    }
  });

  describe('isValidClientId', () => {
    it('returns true for valid client IDs', () => {
      expect(isValidClientId('client_01ABC123')).toBe(true);
      expect(isValidClientId('client_longenoughvalue')).toBe(true);
    });

    it('returns false for invalid client IDs', () => {
      expect(isValidClientId('invalid')).toBe(false);
      expect(isValidClientId('client_')).toBe(false); // too short
      expect(isValidClientId('sk_test_abc')).toBe(false);
    });
  });

  describe('isValidApiKey', () => {
    it('returns true for valid API keys', () => {
      expect(isValidApiKey('sk_test_abc123def')).toBe(true);
      expect(isValidApiKey('sk_live_secretkey123')).toBe(true);
    });

    it('returns false for invalid API keys', () => {
      expect(isValidApiKey('invalid')).toBe(false);
      expect(isValidApiKey('sk_short')).toBe(false);
      expect(isValidApiKey('client_01ABC')).toBe(false);
    });
  });

  describe('checkForEnvFiles', () => {
    it('returns exists: false when no env files present', async () => {
      const result = await checkForEnvFiles(testDir);
      expect(result.exists).toBe(false);
      expect(result.files).toEqual([]);
    });

    it('detects .env.local file', async () => {
      writeFileSync(join(testDir, '.env.local'), 'FOO=bar');

      const result = await checkForEnvFiles(testDir);

      expect(result.exists).toBe(true);
      expect(result.files).toContain('.env.local');
    });

    it('detects multiple env files', async () => {
      writeFileSync(join(testDir, '.env'), 'A=1');
      writeFileSync(join(testDir, '.env.local'), 'B=2');
      writeFileSync(join(testDir, '.env.development'), 'C=3');

      const result = await checkForEnvFiles(testDir);

      expect(result.exists).toBe(true);
      expect(result.files).toHaveLength(3);
      expect(result.files).toContain('.env');
      expect(result.files).toContain('.env.local');
      expect(result.files).toContain('.env.development');
    });
  });

  describe('discoverCredentials', () => {
    it('returns found: false when no env files exist', async () => {
      const result = await discoverCredentials(testDir);
      expect(result.found).toBe(false);
    });

    it('discovers valid client ID from env file', async () => {
      writeFileSync(join(testDir, '.env.local'), 'WORKOS_CLIENT_ID=client_01ABC123');

      const result = await discoverCredentials(testDir);

      expect(result.found).toBe(true);
      expect(result.clientId).toBe('client_01ABC123');
      expect(result.source).toBe('env');
    });

    it('discovers both credentials from single file', async () => {
      writeFileSync(
        join(testDir, '.env.local'),
        `
WORKOS_CLIENT_ID=client_01XYZ789
WORKOS_API_KEY=sk_live_secretkey123
`,
      );

      const result = await discoverCredentials(testDir);

      expect(result.found).toBe(true);
      expect(result.clientId).toBe('client_01XYZ789');
      expect(result.apiKey).toBe('sk_live_secretkey123');
      expect(result.sourcePath).toBe('.env.local');
    });

    it('returns first file with valid clientId (priority order)', async () => {
      writeFileSync(join(testDir, '.env'), 'WORKOS_CLIENT_ID=client_from_dotenv');
      writeFileSync(join(testDir, '.env.local'), 'WORKOS_CLIENT_ID=client_from_local');

      const result = await discoverCredentials(testDir);

      expect(result.clientId).toBe('client_from_local');
      expect(result.sourcePath).toBe('.env.local');
    });

    it('ignores invalid client ID format', async () => {
      writeFileSync(join(testDir, '.env.local'), 'WORKOS_CLIENT_ID=invalid_format');

      const result = await discoverCredentials(testDir);

      expect(result.found).toBe(false);
    });

    it('ignores API key without valid client ID', async () => {
      writeFileSync(join(testDir, '.env.local'), 'WORKOS_API_KEY=sk_test_key_value');

      const result = await discoverCredentials(testDir);

      expect(result.found).toBe(false);
    });

    it('handles double-quoted values', async () => {
      writeFileSync(join(testDir, '.env.local'), 'WORKOS_CLIENT_ID="client_01QUOTED"');

      const result = await discoverCredentials(testDir);

      expect(result.found).toBe(true);
      expect(result.clientId).toBe('client_01QUOTED');
    });

    it('handles single-quoted values', async () => {
      writeFileSync(join(testDir, '.env.local'), "WORKOS_CLIENT_ID='client_01SINGLE'");

      const result = await discoverCredentials(testDir);

      expect(result.found).toBe(true);
      expect(result.clientId).toBe('client_01SINGLE');
    });

    it('ignores commented lines', async () => {
      writeFileSync(
        join(testDir, '.env.local'),
        `
# WORKOS_CLIENT_ID=client_01COMMENTED
WORKOS_CLIENT_ID=client_01ACTUAL
`,
      );

      const result = await discoverCredentials(testDir);

      expect(result.clientId).toBe('client_01ACTUAL');
    });

    it('returns found: false for empty values', async () => {
      writeFileSync(join(testDir, '.env.local'), 'WORKOS_CLIENT_ID=');

      const result = await discoverCredentials(testDir);

      expect(result.found).toBe(false);
    });

    it('includes invalid API key as undefined when clientId is valid', async () => {
      writeFileSync(
        join(testDir, '.env.local'),
        `
WORKOS_CLIENT_ID=client_01VALID
WORKOS_API_KEY=invalid
`,
      );

      const result = await discoverCredentials(testDir);

      expect(result.found).toBe(true);
      expect(result.clientId).toBe('client_01VALID');
      expect(result.apiKey).toBeUndefined();
    });
  });
});
