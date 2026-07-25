import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeCredentialsEnv, writeEnvLocal } from './env-writer.js';

/** POSIX permission bits of `path`. */
const modeOf = (path: string): number => statSync(path).mode & 0o777;

// Windows has no meaningful POSIX permission bits.
const itPosix = it.skipIf(process.platform === 'win32');

describe('writeEnvLocal', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'env-writer-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
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

  it('writes a fresh file with no leading blank line', () => {
    writeEnvLocal(testDir, {
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_COOKIE_PASSWORD: 'pw',
    });

    const content = readFileSync(join(testDir, '.env.local'), 'utf-8');
    expect(content).toBe('WORKOS_CLIENT_ID=client_123\nWORKOS_COOKIE_PASSWORD=pw\n');
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

  it('does not regenerate a cookie password already in the file', () => {
    const envPath = join(testDir, '.env.local');
    writeFileSync(envPath, 'WORKOS_COOKIE_PASSWORD=already_in_file\n');

    writeEnvLocal(testDir, { WORKOS_CLIENT_ID: 'client_123' });

    const content = readFileSync(envPath, 'utf-8');
    expect(content).toBe('WORKOS_COOKIE_PASSWORD=already_in_file\nWORKOS_CLIENT_ID=client_123\n');
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
      WORKOS_COOKIE_PASSWORD: 'pw',
    });

    const content = readFileSync(envPath, 'utf-8');
    expect(content).toBe('WORKOS_CLIENT_ID=client_123\nWORKOS_COOKIE_PASSWORD=pw\n');
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

  describe('line preservation', () => {
    it('rewrites values in place, preserving comments, blanks, and key order', () => {
      const envPath = join(testDir, '.env.local');
      const original = [
        '# WorkOS credentials',
        '',
        'WORKOS_CLIENT_ID=client_old',
        'WORKOS_API_KEY=sk_old',
        'WORKOS_COOKIE_PASSWORD=keep_me',
        '',
        '# Unrelated app config',
        'DATABASE_URL=postgres://localhost/dev',
        '',
      ].join('\n');
      writeFileSync(envPath, original);

      writeEnvLocal(testDir, {
        WORKOS_CLIENT_ID: 'client_new',
        WORKOS_API_KEY: 'sk_new',
      });

      expect(readFileSync(envPath, 'utf-8')).toBe(
        [
          '# WorkOS credentials',
          '',
          'WORKOS_CLIENT_ID=client_new',
          'WORKOS_API_KEY=sk_new',
          'WORKOS_COOKIE_PASSWORD=keep_me',
          '',
          '# Unrelated app config',
          'DATABASE_URL=postgres://localhost/dev',
          '',
        ].join('\n'),
      );
    });

    it('appends genuinely new keys at the end and touches nothing else', () => {
      const envPath = join(testDir, '.env.local');
      const original = '# top\n\nDATABASE_URL=postgres://localhost/dev\n\n# bottom\n';
      writeFileSync(envPath, original);

      writeEnvLocal(testDir, {
        WORKOS_CLIENT_ID: 'client_123',
        WORKOS_COOKIE_PASSWORD: 'pw',
      });

      expect(readFileSync(envPath, 'utf-8')).toBe(
        original + 'WORKOS_CLIENT_ID=client_123\nWORKOS_COOKIE_PASSWORD=pw\n',
      );
    });

    it('preserves a comments-only file', () => {
      const envPath = join(testDir, '.env.local');
      const original = '# This is a comment\n# Another comment\n';
      writeFileSync(envPath, original);

      writeEnvLocal(testDir, {
        WORKOS_CLIENT_ID: 'client_123',
        WORKOS_COOKIE_PASSWORD: 'pw',
      });

      expect(readFileSync(envPath, 'utf-8')).toBe(
        original + 'WORKOS_CLIENT_ID=client_123\nWORKOS_COOKIE_PASSWORD=pw\n',
      );
    });

    it('preserves values containing an equals sign', () => {
      const envPath = join(testDir, '.env.local');
      writeFileSync(envPath, 'KEY_WITH_EQUALS=value=with=equals\nWORKOS_COOKIE_PASSWORD=a=b=c\n');

      writeEnvLocal(testDir, { WORKOS_CLIENT_ID: 'client_123' });

      expect(readFileSync(envPath, 'utf-8')).toBe(
        'KEY_WITH_EQUALS=value=with=equals\nWORKOS_COOKIE_PASSWORD=a=b=c\nWORKOS_CLIENT_ID=client_123\n',
      );
    });

    it('writes a value containing an equals sign verbatim', () => {
      const envPath = join(testDir, '.env.local');
      writeFileSync(envPath, 'WORKOS_COOKIE_PASSWORD=old\n');

      writeEnvLocal(testDir, {
        WORKOS_CLIENT_ID: 'client_123',
        WORKOS_COOKIE_PASSWORD: 'a=b=c',
      });

      expect(readFileSync(envPath, 'utf-8')).toBe('WORKOS_COOKIE_PASSWORD=a=b=c\nWORKOS_CLIENT_ID=client_123\n');
    });

    it('adds exactly one trailing newline to a file that lacked one', () => {
      const envPath = join(testDir, '.env.local');
      writeFileSync(envPath, '# top\nWORKOS_COOKIE_PASSWORD=pw');

      writeEnvLocal(testDir, { WORKOS_CLIENT_ID: 'client_123' });

      expect(readFileSync(envPath, 'utf-8')).toBe('# top\nWORKOS_COOKIE_PASSWORD=pw\nWORKOS_CLIENT_ID=client_123\n');
    });

    it('keeps CRLF line endings on touched, untouched, and appended lines', () => {
      const envPath = join(testDir, '.env.local');
      writeFileSync(envPath, '# top\r\nWORKOS_CLIENT_ID=client_old\r\nDATABASE_URL=postgres://localhost/dev\r\n');

      writeEnvLocal(testDir, {
        WORKOS_CLIENT_ID: 'client_new',
        WORKOS_COOKIE_PASSWORD: 'pw',
      });

      expect(readFileSync(envPath, 'utf-8')).toBe(
        '# top\r\nWORKOS_CLIENT_ID=client_new\r\nDATABASE_URL=postgres://localhost/dev\r\nWORKOS_COOKIE_PASSWORD=pw\r\n',
      );
    });

    it('keeps CRLF endings on a file that lacked a trailing newline', () => {
      const envPath = join(testDir, '.env.local');
      writeFileSync(envPath, '# top\r\nWORKOS_COOKIE_PASSWORD=pw');

      writeEnvLocal(testDir, { WORKOS_CLIENT_ID: 'client_123' });

      expect(readFileSync(envPath, 'utf-8')).toBe(
        '# top\r\nWORKOS_COOKIE_PASSWORD=pw\r\nWORKOS_CLIENT_ID=client_123\r\n',
      );
    });
  });

  describe('file permissions', () => {
    const envVars = {
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_COOKIE_PASSWORD: 'pw',
    };

    itPosix('mirrors the source file mode onto the backup', () => {
      const envPath = join(testDir, '.env.local');
      writeFileSync(envPath, 'WORKOS_API_KEY=sk_live_secret\n');
      chmodSync(envPath, 0o600);

      writeEnvLocal(testDir, envVars);

      expect(modeOf(join(testDir, '.env.local.bak'))).toBe(0o600);
    });

    itPosix('creates a new env file as 0600', () => {
      writeEnvLocal(testDir, envVars);

      expect(modeOf(join(testDir, '.env.local'))).toBe(0o600);
    });

    itPosix('leaves the permissions of an existing env file alone', () => {
      const envPath = join(testDir, '.env.local');
      writeFileSync(envPath, 'DATABASE_URL=postgres://localhost/dev\n');
      chmodSync(envPath, 0o640);

      writeEnvLocal(testDir, envVars);

      expect(modeOf(envPath)).toBe(0o640);
    });

    itPosix('creates a new .env as 0600 outside the JS branch', () => {
      writeCredentialsEnv(testDir, envVars);

      expect(modeOf(join(testDir, '.env'))).toBe(0o600);
    });
  });

  describe('backup', () => {
    const envVars = {
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_COOKIE_PASSWORD: 'pw',
    };

    it('does not create a backup when no env file exists', () => {
      writeEnvLocal(testDir, envVars);

      expect(existsSync(join(testDir, '.env.local.bak'))).toBe(false);
    });

    it('backs up the pre-CLI file before the first mutation', () => {
      const envPath = join(testDir, '.env.local');
      const original = '# mine\nDATABASE_URL=postgres://localhost/dev\n';
      writeFileSync(envPath, original);

      writeEnvLocal(testDir, envVars);

      expect(readFileSync(join(testDir, '.env.local.bak'), 'utf-8')).toBe(original);
    });

    it('keeps the original backup across two writes in the same run', () => {
      const envPath = join(testDir, '.env.local');
      const original = '# mine\nDATABASE_URL=postgres://localhost/dev\n';
      writeFileSync(envPath, original);

      writeEnvLocal(testDir, envVars);
      writeEnvLocal(testDir, { WORKOS_CLIENT_ID: 'client_456', WORKOS_COOKIE_PASSWORD: 'pw' });

      // The backup is the pre-CLI file, not the state after the first write
      expect(readFileSync(join(testDir, '.env.local.bak'), 'utf-8')).toBe(original);
      expect(readFileSync(envPath, 'utf-8')).toContain('WORKOS_CLIENT_ID=client_456');
    });

    it('never overwrites a backup from an earlier run', () => {
      const envPath = join(testDir, '.env.local');
      const backupPath = join(testDir, '.env.local.bak');
      writeFileSync(envPath, 'WORKOS_CLIENT_ID=client_from_run_one\n');
      writeFileSync(backupPath, '# pristine from run one\n');

      writeEnvLocal(testDir, envVars);

      expect(readFileSync(backupPath, 'utf-8')).toBe('# pristine from run one\n');
    });

    it('git-ignores the backup before writing it, in a project with no .gitignore', () => {
      writeFileSync(join(testDir, '.env.local'), 'DATABASE_URL=postgres://localhost/dev\n');

      writeEnvLocal(testDir, envVars);

      expect(existsSync(join(testDir, '.env.local.bak'))).toBe(true);
      expect(readFileSync(join(testDir, '.gitignore'), 'utf-8')).toBe('.env.local.bak\n.env.local\n');
    });

    it('git-ignores the backup in a project whose .gitignore only has .env*.local', () => {
      // The Next.js default: .env*.local covers .env.local but NOT .env.local.bak,
      // and `git add -A` would otherwise commit a live API key and claim token.
      const gitignorePath = join(testDir, '.gitignore');
      writeFileSync(gitignorePath, 'node_modules\n.env*.local\n');
      writeFileSync(join(testDir, '.env.local'), 'DATABASE_URL=postgres://localhost/dev\n');

      writeEnvLocal(testDir, envVars);

      expect(existsSync(join(testDir, '.env.local.bak'))).toBe(true);
      expect(readFileSync(gitignorePath, 'utf-8')).toBe('node_modules\n.env*.local\n.env.local.bak\n');
    });

    it('leaves .gitignore alone when .env* already covers the backup', () => {
      const gitignorePath = join(testDir, '.gitignore');
      writeFileSync(gitignorePath, '.env*\n');
      writeFileSync(join(testDir, '.env.local'), 'DATABASE_URL=postgres://localhost/dev\n');

      writeEnvLocal(testDir, envVars);

      expect(existsSync(join(testDir, '.env.local.bak'))).toBe(true);
      expect(readFileSync(gitignorePath, 'utf-8')).toBe('.env*\n');
    });

    it('leaves .gitignore alone when *.bak already covers the backup', () => {
      const gitignorePath = join(testDir, '.gitignore');
      writeFileSync(gitignorePath, '*.bak\n.env.local\n');
      writeFileSync(join(testDir, '.env.local'), 'DATABASE_URL=postgres://localhost/dev\n');

      writeEnvLocal(testDir, envVars);

      expect(existsSync(join(testDir, '.env.local.bak'))).toBe(true);
      expect(readFileSync(gitignorePath, 'utf-8')).toBe('*.bak\n.env.local\n');
    });

    it('does not write the backup when .gitignore cannot be updated', () => {
      // .gitignore as a directory makes the read/write throw. Proves ordering:
      // an un-ignorable backup must never reach disk.
      mkdirSync(join(testDir, '.gitignore'));
      const original = 'WORKOS_API_KEY=sk_live_secret\n';
      writeFileSync(join(testDir, '.env.local'), original);

      expect(() => writeEnvLocal(testDir, envVars)).toThrow();

      expect(existsSync(join(testDir, '.env.local.bak'))).toBe(false);
      // The env write happens after the backup, so the user's file is intact
      expect(readFileSync(join(testDir, '.env.local'), 'utf-8')).toBe(original);
    });
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

describe('writeCredentialsEnv', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'env-writer-cred-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  const envVars = {
    WORKOS_API_KEY: 'sk_test_new',
    WORKOS_CLIENT_ID: 'client_new',
  };

  it('delegates to .env.local when package.json is present', () => {
    writeFileSync(join(testDir, 'package.json'), '{}\n');

    writeCredentialsEnv(testDir, envVars);

    expect(existsSync(join(testDir, '.env.local'))).toBe(true);
    expect(existsSync(join(testDir, '.env'))).toBe(false);
  });

  it('rewrites .env values in place, preserving comments, blanks, and order', () => {
    const envPath = join(testDir, '.env');
    const original = [
      '# WorkOS',
      '',
      'WORKOS_CLIENT_ID=client_old',
      'WORKOS_API_KEY=sk_old',
      '',
      '# Django',
      'DJANGO_SECRET_KEY=abc=def',
      '',
    ].join('\n');
    writeFileSync(envPath, original);

    writeCredentialsEnv(testDir, envVars);

    expect(readFileSync(envPath, 'utf-8')).toBe(
      [
        '# WorkOS',
        '',
        'WORKOS_CLIENT_ID=client_new',
        'WORKOS_API_KEY=sk_test_new',
        '',
        '# Django',
        'DJANGO_SECRET_KEY=abc=def',
        '',
      ].join('\n'),
    );
  });

  it('does not generate a cookie password outside the JS branch', () => {
    writeCredentialsEnv(testDir, envVars);

    const content = readFileSync(join(testDir, '.env'), 'utf-8');
    expect(content).toBe('WORKOS_API_KEY=sk_test_new\nWORKOS_CLIENT_ID=client_new\n');
  });

  it('backs up .env once and git-ignores the backup', () => {
    const envPath = join(testDir, '.env');
    const original = '# mine\nDJANGO_SECRET_KEY=abc\n';
    writeFileSync(envPath, original);

    writeCredentialsEnv(testDir, envVars);
    writeCredentialsEnv(testDir, { WORKOS_CLIENT_ID: 'client_third' });

    expect(readFileSync(join(testDir, '.env.bak'), 'utf-8')).toBe(original);
    expect(readFileSync(join(testDir, '.gitignore'), 'utf-8')).toBe('.env.bak\n.env\n');
  });
});
