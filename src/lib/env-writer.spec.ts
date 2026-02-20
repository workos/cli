import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeEnvLocal } from './env-writer.js';

describe('writeEnvLocal', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'env-writer-test-'));
  });

  afterEach(() => {
    for (const file of ['.env.local', '.gitignore']) {
      const filePath = join(testDir, file);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    }
  });

  it('creates .env.local when none exists', () => {
    writeEnvLocal(testDir, {
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
    });

    const envPath = join(testDir, '.env.local');
    expect(existsSync(envPath)).toBe(true);

    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('WORKOS_CLIENT_ID=client_123');
    expect(content).toContain('WORKOS_REDIRECT_URI=http://localhost:3000/callback');
  });

  it('generates cookie password when not provided', () => {
    writeEnvLocal(testDir, {
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
    });

    const content = readFileSync(join(testDir, '.env.local'), 'utf-8');
    expect(content).toMatch(/WORKOS_COOKIE_PASSWORD=[a-f0-9]{32}/);
  });

  it('preserves cookie password if already set', () => {
    writeEnvLocal(testDir, {
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
      WORKOS_COOKIE_PASSWORD: 'my-existing-password',
    });

    const content = readFileSync(join(testDir, '.env.local'), 'utf-8');
    expect(content).toContain('WORKOS_COOKIE_PASSWORD=my-existing-password');
  });

  it('merges with existing .env.local without overwriting', () => {
    const envPath = join(testDir, '.env.local');
    writeFileSync(envPath, 'EXISTING_VAR=existing_value\nOTHER_VAR=other\n');

    writeEnvLocal(testDir, {
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
    });

    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('EXISTING_VAR=existing_value');
    expect(content).toContain('OTHER_VAR=other');
    expect(content).toContain('WORKOS_CLIENT_ID=client_123');
  });

  it('new vars take precedence over existing', () => {
    const envPath = join(testDir, '.env.local');
    writeFileSync(envPath, 'WORKOS_CLIENT_ID=old_client\n');

    writeEnvLocal(testDir, {
      WORKOS_CLIENT_ID: 'new_client',
      WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
    });

    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('WORKOS_CLIENT_ID=new_client');
    expect(content).not.toContain('old_client');
  });

  it('handles empty existing .env file', () => {
    const envPath = join(testDir, '.env.local');
    writeFileSync(envPath, '');

    writeEnvLocal(testDir, {
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
    });

    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('WORKOS_CLIENT_ID=client_123');
  });

  it('handles comments in existing .env file', () => {
    const envPath = join(testDir, '.env.local');
    writeFileSync(envPath, '# This is a comment\nEXISTING=value\n# Another comment\n');

    writeEnvLocal(testDir, {
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
    });

    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('EXISTING=value');
    expect(content).toContain('WORKOS_CLIENT_ID=client_123');
    // Comments are not preserved in simple parser, which is fine
  });

  it('handles values containing equals sign', () => {
    const envPath = join(testDir, '.env.local');
    writeFileSync(envPath, 'KEY_WITH_EQUALS=value=with=equals\n');

    writeEnvLocal(testDir, {
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
    });

    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('KEY_WITH_EQUALS=value=with=equals');
  });

  it('includes API key when provided', () => {
    writeEnvLocal(testDir, {
      WORKOS_API_KEY: 'sk_test_123',
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
    });

    const content = readFileSync(join(testDir, '.env.local'), 'utf-8');
    expect(content).toContain('WORKOS_API_KEY=sk_test_123');
  });

  describe('gitignore handling', () => {
    const envVars = {
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
    };

    it('creates .gitignore with .env.local when no .gitignore exists', () => {
      writeEnvLocal(testDir, envVars);

      const gitignorePath = join(testDir, '.gitignore');
      expect(existsSync(gitignorePath)).toBe(true);
      expect(readFileSync(gitignorePath, 'utf-8')).toBe('.env.local\n');
    });

    it('appends .env.local to existing .gitignore that does not include it', () => {
      const gitignorePath = join(testDir, '.gitignore');
      writeFileSync(gitignorePath, 'node_modules\ndist\n');

      writeEnvLocal(testDir, envVars);

      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('node_modules\n');
      expect(content).toContain('.env.local\n');
    });

    it('does not duplicate .env.local if already present', () => {
      const gitignorePath = join(testDir, '.gitignore');
      writeFileSync(gitignorePath, 'node_modules\n.env.local\n');

      writeEnvLocal(testDir, envVars);

      const content = readFileSync(gitignorePath, 'utf-8');
      const matches = content.match(/\.env\.local/g);
      expect(matches).toHaveLength(1);
    });

    it('does not add .env.local if .env*.local pattern exists', () => {
      const gitignorePath = join(testDir, '.gitignore');
      writeFileSync(gitignorePath, 'node_modules\n.env*.local\n');

      writeEnvLocal(testDir, envVars);

      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).not.toContain('\n.env.local\n');
    });

    it('does not add .env.local if .env* pattern exists', () => {
      const gitignorePath = join(testDir, '.gitignore');
      writeFileSync(gitignorePath, '.env*\n');

      writeEnvLocal(testDir, envVars);

      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).toBe('.env*\n');
    });

    it('preserves existing .gitignore content when appending', () => {
      const gitignorePath = join(testDir, '.gitignore');
      const original = 'node_modules\ndist\n.DS_Store\n';
      writeFileSync(gitignorePath, original);

      writeEnvLocal(testDir, envVars);

      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).toBe(original + '.env.local\n');
    });

    it('handles .gitignore without trailing newline', () => {
      const gitignorePath = join(testDir, '.gitignore');
      writeFileSync(gitignorePath, 'node_modules');

      writeEnvLocal(testDir, envVars);

      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).toBe('node_modules\n.env.local\n');
    });
  });
});
