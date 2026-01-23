import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkForEnvFiles,
  scanEnvFile,
  isValidClientId,
  isValidApiKey,
  discoverCredentials,
} from './credential-discovery.js';

describe('credential-discovery', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'credential-discovery-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('checkForEnvFiles', () => {
    it('returns exists: true when .env exists', async () => {
      writeFileSync(join(testDir, '.env'), 'FOO=bar');
      const result = await checkForEnvFiles(testDir);
      expect(result.exists).toBe(true);
      expect(result.files).toContain('.env');
    });

    it('returns exists: false when no env files', async () => {
      const result = await checkForEnvFiles(testDir);
      expect(result.exists).toBe(false);
      expect(result.files).toHaveLength(0);
    });

    it('lists all found env files', async () => {
      writeFileSync(join(testDir, '.env'), 'FOO=bar');
      writeFileSync(join(testDir, '.env.local'), 'BAZ=qux');
      writeFileSync(join(testDir, '.env.development'), 'DEV=true');

      const result = await checkForEnvFiles(testDir);
      expect(result.exists).toBe(true);
      expect(result.files).toHaveLength(3);
      expect(result.files).toContain('.env');
      expect(result.files).toContain('.env.local');
      expect(result.files).toContain('.env.development');
    });
  });

  describe('scanEnvFile', () => {
    it('extracts WORKOS_CLIENT_ID from file', async () => {
      const envPath = join(testDir, '.env');
      writeFileSync(envPath, 'WORKOS_CLIENT_ID=client_123456789');

      const result = await scanEnvFile(envPath);
      expect(result.clientId).toBe('client_123456789');
    });

    it('extracts WORKOS_API_KEY from file', async () => {
      const envPath = join(testDir, '.env');
      writeFileSync(envPath, 'WORKOS_API_KEY=sk_test_123456789');

      const result = await scanEnvFile(envPath);
      expect(result.apiKey).toBe('sk_test_123456789');
    });

    it('handles double-quoted values', async () => {
      const envPath = join(testDir, '.env');
      writeFileSync(envPath, 'WORKOS_CLIENT_ID="client_123456789"');

      const result = await scanEnvFile(envPath);
      expect(result.clientId).toBe('client_123456789');
    });

    it('handles single-quoted values', async () => {
      const envPath = join(testDir, '.env');
      writeFileSync(envPath, "WORKOS_CLIENT_ID='client_123456789'");

      const result = await scanEnvFile(envPath);
      expect(result.clientId).toBe('client_123456789');
    });

    it('handles unquoted values', async () => {
      const envPath = join(testDir, '.env');
      writeFileSync(envPath, 'WORKOS_CLIENT_ID=client_123456789');

      const result = await scanEnvFile(envPath);
      expect(result.clientId).toBe('client_123456789');
    });

    it('ignores commented lines', async () => {
      const envPath = join(testDir, '.env');
      writeFileSync(
        envPath,
        `# WORKOS_CLIENT_ID=client_commented_out
WORKOS_CLIENT_ID=client_actual_value`
      );

      const result = await scanEnvFile(envPath);
      expect(result.clientId).toBe('client_actual_value');
    });

    it('returns undefined for missing values', async () => {
      const envPath = join(testDir, '.env');
      writeFileSync(envPath, 'OTHER_VAR=something');

      const result = await scanEnvFile(envPath);
      expect(result.clientId).toBeUndefined();
      expect(result.apiKey).toBeUndefined();
    });

    it('does not extract other env vars', async () => {
      const envPath = join(testDir, '.env');
      writeFileSync(
        envPath,
        `DATABASE_URL=postgres://localhost
SECRET_KEY=supersecret
WORKOS_CLIENT_ID=client_123456789`
      );

      const result = await scanEnvFile(envPath);
      // Only clientId should be present
      expect(result.clientId).toBe('client_123456789');
      expect(result.apiKey).toBeUndefined();
      // Verify we're not accidentally returning other keys
      expect(Object.keys(result)).toEqual(['clientId', 'apiKey']);
    });
  });

  describe('isValidClientId', () => {
    it('accepts client_ prefixed strings', () => {
      expect(isValidClientId('client_123456789')).toBe(true);
    });

    it('rejects strings without client_ prefix', () => {
      expect(isValidClientId('notclient_123456789')).toBe(false);
      expect(isValidClientId('sk_123456789')).toBe(false);
    });

    it('rejects too-short strings', () => {
      expect(isValidClientId('client_')).toBe(false);
      expect(isValidClientId('client_12')).toBe(false);
    });
  });

  describe('isValidApiKey', () => {
    it('accepts sk_ prefixed strings', () => {
      expect(isValidApiKey('sk_test_123456789')).toBe(true);
      expect(isValidApiKey('sk_live_abcdefghi')).toBe(true);
    });

    it('rejects strings without sk_ prefix', () => {
      expect(isValidApiKey('client_123456789')).toBe(false);
      expect(isValidApiKey('pk_test_123456789')).toBe(false);
    });

    it('rejects too-short strings', () => {
      expect(isValidApiKey('sk_')).toBe(false);
      expect(isValidApiKey('sk_ab')).toBe(false);
    });
  });

  describe('discoverCredentials', () => {
    it('returns credentials from .env.local first', async () => {
      // Both files have credentials, but .env.local has priority
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_CLIENT_ID=client_from_local'
      );
      writeFileSync(
        join(testDir, '.env'),
        'WORKOS_CLIENT_ID=client_from_dotenv'
      );

      const result = await discoverCredentials(testDir);
      expect(result.found).toBe(true);
      expect(result.clientId).toBe('client_from_local');
      expect(result.sourcePath).toBe('.env.local');
    });

    it('falls back to .env if .env.local missing', async () => {
      writeFileSync(
        join(testDir, '.env'),
        'WORKOS_CLIENT_ID=client_from_dotenv'
      );

      const result = await discoverCredentials(testDir);
      expect(result.found).toBe(true);
      expect(result.clientId).toBe('client_from_dotenv');
      expect(result.sourcePath).toBe('.env');
    });

    it('returns found: false when no credentials', async () => {
      // File exists but no WorkOS credentials
      writeFileSync(join(testDir, '.env'), 'DATABASE_URL=postgres://localhost');

      const result = await discoverCredentials(testDir);
      expect(result.found).toBe(false);
    });

    it('returns found: false when no env files', async () => {
      const result = await discoverCredentials(testDir);
      expect(result.found).toBe(false);
    });

    it('returns partial result (clientId only) when no apiKey', async () => {
      writeFileSync(
        join(testDir, '.env'),
        'WORKOS_CLIENT_ID=client_123456789'
      );

      const result = await discoverCredentials(testDir);
      expect(result.found).toBe(true);
      expect(result.clientId).toBe('client_123456789');
      expect(result.apiKey).toBeUndefined();
    });

    it('returns both clientId and apiKey when both present', async () => {
      writeFileSync(
        join(testDir, '.env'),
        `WORKOS_CLIENT_ID=client_123456789
WORKOS_API_KEY=sk_test_abcdefghi`
      );

      const result = await discoverCredentials(testDir);
      expect(result.found).toBe(true);
      expect(result.clientId).toBe('client_123456789');
      expect(result.apiKey).toBe('sk_test_abcdefghi');
      expect(result.source).toBe('env');
    });

    it('skips invalid clientId format', async () => {
      writeFileSync(join(testDir, '.env'), 'WORKOS_CLIENT_ID=invalid_format');

      const result = await discoverCredentials(testDir);
      expect(result.found).toBe(false);
    });

    it('includes valid apiKey only when clientId is valid', async () => {
      writeFileSync(
        join(testDir, '.env'),
        `WORKOS_CLIENT_ID=invalid_format
WORKOS_API_KEY=sk_test_abcdefghi`
      );

      const result = await discoverCredentials(testDir);
      // Even though apiKey is valid, clientId is not, so no match
      expect(result.found).toBe(false);
    });
  });
});
