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
    const envPath = join(testDir, '.env.local');
    if (existsSync(envPath)) {
      unlinkSync(envPath);
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
});
