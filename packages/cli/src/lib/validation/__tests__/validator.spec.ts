import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateInstallation } from '../validator.js';

describe('validateInstallation', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'validator-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('unknown framework', () => {
    it('returns empty result for unknown framework', async () => {
      const result = await validateInstallation('unknown-framework', testDir);

      expect(result.passed).toBe(true);
      expect(result.framework).toBe('unknown-framework');
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('package validation', () => {
    it('detects missing package', async () => {
      // Create package.json without required package
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          dependencies: {},
        }),
      );
      // Create .env.local with required vars to isolate package test
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=test123\n',
      );

      const result = await validateInstallation('nextjs', testDir);

      const pkgIssue = result.issues.find((i) => i.type === 'package');
      expect(pkgIssue).toBeDefined();
      expect(pkgIssue?.message).toContain('@workos-inc/authkit-nextjs');
      expect(pkgIssue?.severity).toBe('error');
    });

    it('passes when package is present in dependencies', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          dependencies: {
            '@workos-inc/authkit-nextjs': '^1.0.0',
          },
        }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=test123\n',
      );
      // Create required files to isolate package test
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      writeFileSync(join(testDir, 'middleware.ts'), "import { authkitMiddleware } from '@workos-inc/authkit-nextjs';");
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir);

      const pkgIssue = result.issues.find((i) => i.type === 'package');
      expect(pkgIssue).toBeUndefined();
    });

    it('handles malformed package.json gracefully', async () => {
      writeFileSync(join(testDir, 'package.json'), '{ invalid json }');
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=test123\n',
      );

      const result = await validateInstallation('nextjs', testDir);

      // Should not crash, just skip package validation
      expect(result).toBeDefined();
      // Should still have file issues since no files exist
      expect(result.issues.some((i) => i.type === 'file')).toBe(true);
    });
  });

  describe('env var validation', () => {
    it('detects missing .env.local', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' },
        }),
      );

      const result = await validateInstallation('nextjs', testDir);

      const envIssue = result.issues.find((i) => i.type === 'env' && i.message.includes('.env.local'));
      expect(envIssue).toBeDefined();
      expect(envIssue?.severity).toBe('error');
    });

    it('detects missing environment variable', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' },
        }),
      );
      // Missing WORKOS_COOKIE_PASSWORD
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\n',
      );

      const result = await validateInstallation('nextjs', testDir);

      const envIssue = result.issues.find((i) => i.type === 'env' && i.message.includes('WORKOS_COOKIE_PASSWORD'));
      expect(envIssue).toBeDefined();
      expect(envIssue?.hint).toContain('.env.local');
    });

    it('passes when all env vars present', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' },
        }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=secret123\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      writeFileSync(join(testDir, 'middleware.ts'), "import { authkitMiddleware } from '@workos-inc/authkit-nextjs';");
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir);

      const envIssues = result.issues.filter((i) => i.type === 'env');
      expect(envIssues).toHaveLength(0);
    });
  });

  describe('file validation', () => {
    it('detects missing callback route file', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' },
        }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=test123\n',
      );
      // No callback route file created

      const result = await validateInstallation('nextjs', testDir);

      const fileIssue = result.issues.find((i) => i.type === 'file' && i.message.includes('callback'));
      expect(fileIssue).toBeDefined();
      expect(fileIssue?.severity).toBe('error');
    });

    it('detects missing middleware file', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' },
        }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=test123\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      mkdirSync(join(testDir, 'app'), { recursive: true });
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');
      // No middleware.ts or proxy.ts

      const result = await validateInstallation('nextjs', testDir);

      const fileIssue = result.issues.find((i) => i.type === 'file' && i.message.includes('middleware'));
      expect(fileIssue).toBeDefined();
    });
  });

  describe('pattern validation', () => {
    it('detects missing pattern in file', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' },
        }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=test123\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      // Missing required patterns
      writeFileSync(join(testDir, 'app', 'callback', 'route.ts'), 'export function GET() {}');
      writeFileSync(join(testDir, 'middleware.ts'), 'export default function middleware() {}');
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<div>Layout</div>');

      const result = await validateInstallation('nextjs', testDir);

      const patternIssues = result.issues.filter((i) => i.type === 'pattern');
      expect(patternIssues.length).toBeGreaterThan(0);
      expect(patternIssues[0].severity).toBe('warning');
    });

    it('passes when mustContainAny has at least one match', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' },
        }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=test123\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      // Has 'authkit' which satisfies mustContainAny
      writeFileSync(join(testDir, 'middleware.ts'), "import { authkit } from 'some-package';");
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir);

      const middlewarePatternIssue = result.issues.find(
        (i) => i.type === 'pattern' && i.message.includes('middleware'),
      );
      expect(middlewarePatternIssue).toBeUndefined();
    });
  });

  describe('overall result', () => {
    it('passed is false when there are error-level issues', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ dependencies: {} }));
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=test123\n',
      );

      const result = await validateInstallation('nextjs', testDir);

      expect(result.passed).toBe(false);
      expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
    });

    it('passed is true when only warning-level issues', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' },
        }),
      );
      // Redirect URI path must match the callback route location
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=test123\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      // File exists but missing some patterns (warning level)
      writeFileSync(join(testDir, 'app', 'callback', 'route.ts'), "import { handleAuth } from '@workos-inc/authkit-nextjs';");
      writeFileSync(join(testDir, 'middleware.ts'), 'export const authkitMiddleware = () => {};');
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir);

      // All required files exist with required patterns, should pass
      expect(result.passed).toBe(true);
    });

    it('includes duration in result', async () => {
      const result = await validateInstallation('unknown', testDir);

      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('redirect URI validation (Next.js)', () => {
    it('detects redirect URI path mismatch with callback route', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      // Redirect URI says /auth/callback but route is at /api/auth/callback
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback\nWORKOS_COOKIE_PASSWORD=test123\n',
      );
      // Route exists at DIFFERENT path
      mkdirSync(join(testDir, 'app', 'api', 'auth', 'callback'), { recursive: true });
      writeFileSync(join(testDir, 'app', 'api', 'auth', 'callback', 'route.ts'), "import { handleAuth } from '@workos-inc/authkit-nextjs';");
      writeFileSync(join(testDir, 'middleware.ts'), 'export const authkitMiddleware = () => {};');
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      expect(result.passed).toBe(false);
      const mismatchIssue = result.issues.find((i) => i.message.includes('no matching route file'));
      expect(mismatchIssue).toBeDefined();
      expect(mismatchIssue?.hint).toContain('/api/auth/callback');
    });

    it('passes when redirect URI matches callback route path', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback\nWORKOS_COOKIE_PASSWORD=test123\n',
      );
      mkdirSync(join(testDir, 'app', 'api', 'auth', 'callback'), { recursive: true });
      writeFileSync(join(testDir, 'app', 'api', 'auth', 'callback', 'route.ts'), "import { handleAuth } from '@workos-inc/authkit-nextjs';");
      writeFileSync(join(testDir, 'middleware.ts'), 'export const authkitMiddleware = () => {};');
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const mismatchIssue = result.issues.find((i) => i.message.includes('no matching route file'));
      expect(mismatchIssue).toBeUndefined();
    });

    it('detects invalid redirect URI format', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ dependencies: {} }));
      writeFileSync(join(testDir, '.env.local'), 'NEXT_PUBLIC_WORKOS_REDIRECT_URI=not-a-valid-url\n');

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const invalidIssue = result.issues.find((i) => i.message.includes('Invalid redirect URI'));
      expect(invalidIssue).toBeDefined();
    });
  });
});
