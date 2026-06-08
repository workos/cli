import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runInstallSecurityChecks,
  securityFindingsToIssues,
  formatSecurityFindingsForAgent,
  formatBlockingSecurityError,
} from './security-checks.js';
import type { AuthPatternFinding } from '../../doctor/types.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'install-security-'));
}

function writeFixtureFile(dir: string, relativePath: string, content: string) {
  const fullPath = join(dir, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

describe('runInstallSecurityChecks', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('flags a GET sign-out route for Next.js as a blocking finding', async () => {
    writeFixtureFile(testDir, 'app/auth/signout/route.ts', 'export async function GET() { return signOut(); }');

    const { findings, blocking } = await runInstallSecurityChecks('nextjs', testDir);

    const signout = findings.find((f) => f.code === 'SIGNOUT_GET_HANDLER');
    expect(signout).toBeDefined();
    expect(blocking.map((f) => f.code)).toContain('SIGNOUT_GET_HANDLER');
  });

  it('returns no blocking findings for a clean POST sign-out install', async () => {
    writeFixtureFile(
      testDir,
      'app/auth/actions.ts',
      "'use server';\nexport async function signOutAction() { await signOut(); }",
    );

    const { blocking } = await runInstallSecurityChecks('nextjs', testDir);

    expect(blocking).toEqual([]);
  });

  it('treats a hardcoded API key in source as blocking (framework-agnostic)', async () => {
    writeFixtureFile(testDir, 'app/page.tsx', 'const key = "sk_test_FIXTUREKEYFORTESTING1";');

    const { blocking } = await runInstallSecurityChecks('nextjs', testDir);

    expect(blocking.map((f) => f.code)).toContain('API_KEY_IN_SOURCE');
  });

  it('treats a client-exposed secret API key as blocking', async () => {
    // NEXT_PUBLIC_ prefix ships the secret to the browser bundle.
    writeFixtureFile(testDir, '.env.local', 'NEXT_PUBLIC_WORKOS_API_KEY=sk_live_FIXTUREKEYFORTESTING1\n');

    const { blocking } = await runInstallSecurityChecks('nextjs', testDir);

    expect(blocking.map((f) => f.code)).toContain('API_KEY_LEAKED_TO_CLIENT');
  });

  it('reports warning-severity findings without blocking', async () => {
    // .env.local present but not gitignored -> ENV_FILE_NOT_GITIGNORED (warning)
    writeFixtureFile(testDir, '.env.local', 'WORKOS_CLIENT_ID=client_test\n');

    const { findings, blocking } = await runInstallSecurityChecks('nextjs', testDir);

    expect(findings.map((f) => f.code)).toContain('ENV_FILE_NOT_GITIGNORED');
    expect(blocking).toEqual([]);
  });

  it('still runs cross-framework checks for an unknown integration', async () => {
    writeFixtureFile(testDir, 'src/app.ts', 'const key = "sk_live_FIXTUREKEYFORTESTING1";');

    const { blocking } = await runInstallSecurityChecks('some-backend', testDir);

    expect(blocking.map((f) => f.code)).toContain('API_KEY_IN_SOURCE');
  });
});

describe('securityFindingsToIssues', () => {
  it('maps findings to pattern issues, folding filePath into the message', () => {
    const findings: AuthPatternFinding[] = [
      {
        code: 'SIGNOUT_GET_HANDLER',
        severity: 'error',
        message: 'Signout uses GET',
        filePath: 'app/auth/signout/route.ts',
        remediation: 'Use a POST server action.',
      },
    ];

    const issues = securityFindingsToIssues(findings);

    expect(issues).toEqual([
      {
        type: 'pattern',
        severity: 'error',
        message: 'Signout uses GET (app/auth/signout/route.ts)',
        hint: 'Use a POST server action.',
      },
    ]);
  });
});

describe('formatSecurityFindingsForAgent', () => {
  it('returns an empty string when there are no findings', () => {
    expect(formatSecurityFindingsForAgent([])).toBe('');
  });

  it('includes the message, location, and remediation for each finding', () => {
    const prompt = formatSecurityFindingsForAgent([
      {
        code: 'SIGNOUT_GET_HANDLER',
        severity: 'error',
        message: 'Signout uses GET',
        filePath: 'app/auth/signout/route.ts',
        remediation: 'Use a POST server action.',
      },
    ]);

    expect(prompt).toContain('Signout uses GET');
    expect(prompt).toContain('app/auth/signout/route.ts');
    expect(prompt).toContain('Use a POST server action.');
  });
});

describe('formatBlockingSecurityError', () => {
  it('lists each blocking finding by code', () => {
    const message = formatBlockingSecurityError([
      { code: 'SIGNOUT_GET_HANDLER', severity: 'error', message: 'Signout uses GET' },
    ]);

    expect(message).toContain('SIGNOUT_GET_HANDLER');
    expect(message).toContain('workos doctor');
  });
});
