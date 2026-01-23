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
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
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
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
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
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
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
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\n',
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
        'WORKOS_API_KEY=sk_test_key\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      writeFileSync(join(testDir, 'middleware.ts'), "import { authkitMiddleware } from '@workos-inc/authkit-nextjs';");
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

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
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
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
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
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
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
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
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
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
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://test\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
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
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      // File exists but missing some patterns (warning level)
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
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
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      // Route exists at DIFFERENT path
      mkdirSync(join(testDir, 'app', 'api', 'auth', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'api', 'auth', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
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
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      mkdirSync(join(testDir, 'app', 'api', 'auth', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'api', 'auth', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
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

  describe('redirect URI validation (React Router)', () => {
    it('detects redirect URI path mismatch with callback route', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ dependencies: { 'react-router': '^7.0.0' } }));
      // Redirect URI says /auth/callback but route is at /callback
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nWORKOS_REDIRECT_URI=http://localhost:3000/auth/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      // Route exists at DIFFERENT path (dot notation)
      mkdirSync(join(testDir, 'app', 'routes'), { recursive: true });
      writeFileSync(join(testDir, 'app', 'routes', 'callback.tsx'), 'export default function Callback() {}');

      const result = await validateInstallation('react-router', testDir, { runBuild: false });

      const mismatchIssue = result.issues.find((i) => i.message.includes('no matching route file'));
      expect(mismatchIssue).toBeDefined();
      expect(mismatchIssue?.hint).toContain('callback');
    });

    it('passes when redirect URI matches callback route (dot notation)', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ dependencies: { 'react-router': '^7.0.0' } }));
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test_id\nWORKOS_REDIRECT_URI=http://localhost:3000/auth/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      // Route at correct path using dot notation: auth.callback.tsx
      mkdirSync(join(testDir, 'app', 'routes'), { recursive: true });
      writeFileSync(join(testDir, 'app', 'routes', 'auth.callback.tsx'), 'export default function Callback() {}');

      const result = await validateInstallation('react-router', testDir, { runBuild: false });

      const mismatchIssue = result.issues.find((i) => i.message.includes('no matching route file'));
      expect(mismatchIssue).toBeUndefined();
    });
  });

  describe('redirect URI validation (TanStack Start)', () => {
    it('detects redirect URI path mismatch with callback route', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@tanstack/react-start': '^1.0.0' } }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test_1234567890123456789012345\nWORKOS_CLIENT_ID=client_test_id\nWORKOS_REDIRECT_URI=http://localhost:3000/auth/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      // Route at wrong path
      mkdirSync(join(testDir, 'app', 'routes', 'api', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'routes', 'api', 'callback', 'index.tsx'),
        'export default function Callback() {}',
      );

      const result = await validateInstallation('tanstack-start', testDir, { runBuild: false });

      const mismatchIssue = result.issues.find((i) => i.message.includes('no matching route file'));
      expect(mismatchIssue).toBeDefined();
    });

    it('passes when redirect URI matches callback route', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@tanstack/react-start': '^1.0.0' } }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test_1234567890123456789012345\nWORKOS_CLIENT_ID=client_test_id\nWORKOS_REDIRECT_URI=http://localhost:3000/auth/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      mkdirSync(join(testDir, 'app', 'routes', 'auth', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'routes', 'auth', 'callback', 'index.tsx'),
        'export default function Callback() {}',
      );

      const result = await validateInstallation('tanstack-start', testDir, { runBuild: false });

      const mismatchIssue = result.issues.find((i) => i.message.includes('no matching route file'));
      expect(mismatchIssue).toBeUndefined();
    });
  });

  describe('cookie password length validation', () => {
    it('detects cookie password shorter than 32 characters', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test_key\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=tooshort\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      writeFileSync(join(testDir, 'middleware.ts'), 'export const authkitMiddleware = () => {};');
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const pwIssue = result.issues.find((i) => i.message.includes('at least 32 characters'));
      expect(pwIssue).toBeDefined();
      expect(pwIssue?.severity).toBe('error');
      expect(pwIssue?.hint).toContain('openssl');
    });

    it('passes when cookie password is 32+ characters', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test_key\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      writeFileSync(join(testDir, 'middleware.ts'), 'export const authkitMiddleware = () => {};');
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const pwIssue = result.issues.find((i) => i.message.includes('at least 32 characters'));
      expect(pwIssue).toBeUndefined();
    });
  });

  describe('credential format validation', () => {
    it('detects invalid API key format', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=invalid_key_format\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const keyIssue = result.issues.find((i) => i.message.includes('Invalid API key format'));
      expect(keyIssue).toBeDefined();
      expect(keyIssue?.hint).toContain('sk_');
    });

    it('detects invalid Client ID format', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test_key\nWORKOS_CLIENT_ID=invalid_client_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const clientIssue = result.issues.find((i) => i.message.includes('Invalid Client ID format'));
      expect(clientIssue).toBeDefined();
      expect(clientIssue?.hint).toContain('client_');
    });

    it('passes when credentials have correct format', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test_key\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      writeFileSync(join(testDir, 'middleware.ts'), 'export const authkitMiddleware = () => {};');
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const formatIssues = result.issues.filter(
        (i) => i.message.includes('Invalid API key') || i.message.includes('Invalid Client ID'),
      );
      expect(formatIssues).toHaveLength(0);
    });
  });

  describe('middleware placement validation', () => {
    it('detects middleware in wrong location', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test_key\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      // Middleware in wrong location (nested in app/)
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      writeFileSync(join(testDir, 'app', 'middleware.ts'), 'export const authkitMiddleware = () => {};');
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const middlewareIssue = result.issues.find((i) => i.message.includes('wrong location'));
      expect(middlewareIssue).toBeDefined();
      expect(middlewareIssue?.hint).toContain('project root');
    });

    it('passes when middleware is at project root', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test_key\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      writeFileSync(join(testDir, 'middleware.ts'), 'export const authkitMiddleware = () => {};');
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const middlewareIssue = result.issues.find((i) => i.message.includes('wrong location'));
      expect(middlewareIssue).toBeUndefined();
    });

    it('passes when middleware is in src/ folder', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test_key\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      mkdirSync(join(testDir, 'src', 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'src', 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'middleware.ts'), 'export const authkitMiddleware = () => {};');
      writeFileSync(join(testDir, 'src', 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const middlewareIssue = result.issues.find((i) => i.message.includes('wrong location'));
      expect(middlewareIssue).toBeUndefined();
    });
  });

  describe('provider wrapping validation (React SPA)', () => {
    it('detects missing AuthKitProvider in React SPA', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-react': '^1.0.0' } }),
      );
      writeFileSync(join(testDir, '.env.local'), 'WORKOS_CLIENT_ID=client_test_id\n');
      // No AuthKitProvider in entry files
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'main.tsx'), 'ReactDOM.render(<App />, document.getElementById("root"));');

      const result = await validateInstallation('react', testDir, { runBuild: false });

      const providerIssue = result.issues.find((i) => i.message.includes('AuthKitProvider'));
      expect(providerIssue).toBeDefined();
      expect(providerIssue?.severity).toBe('warning');
    });

    it('passes when AuthKitProvider is present in main.tsx', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-react': '^1.0.0' } }),
      );
      writeFileSync(join(testDir, '.env.local'), 'WORKOS_CLIENT_ID=client_test_id\n');
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(
        join(testDir, 'src', 'main.tsx'),
        '<AuthKitProvider clientId="client_test"><App /></AuthKitProvider>',
      );

      const result = await validateInstallation('react', testDir, { runBuild: false });

      const providerIssue = result.issues.find((i) => i.message.includes('AuthKitProvider'));
      expect(providerIssue).toBeUndefined();
    });
  });

  describe('duplicate env var detection', () => {
    it('detects conflicting values between .env and .env.local', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      // Different values for WORKOS_API_KEY
      writeFileSync(join(testDir, '.env'), 'WORKOS_API_KEY=sk_old_key\n');
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_new_key\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const dupIssue = result.issues.find((i) => i.message.includes('different values'));
      expect(dupIssue).toBeDefined();
      expect(dupIssue?.severity).toBe('warning');
      expect(dupIssue?.hint).toContain('precedence');
    });

    it('passes when env vars are consistent', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      // Same values in both files
      writeFileSync(join(testDir, '.env'), 'WORKOS_API_KEY=sk_test_key\n');
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test_key\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      writeFileSync(join(testDir, 'middleware.ts'), 'export const authkitMiddleware = () => {};');
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const dupIssue = result.issues.find((i) => i.message.includes('different values'));
      expect(dupIssue).toBeUndefined();
    });

    it('ignores when only .env.local exists (no conflict possible)', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-nextjs': '^1.0.0' } }),
      );
      // Only .env.local, no .env
      writeFileSync(
        join(testDir, '.env.local'),
        'WORKOS_API_KEY=sk_test_key\nWORKOS_CLIENT_ID=client_test_id\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback\nWORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!\n',
      );
      mkdirSync(join(testDir, 'app', 'callback'), { recursive: true });
      writeFileSync(
        join(testDir, 'app', 'callback', 'route.ts'),
        "import { handleAuth } from '@workos-inc/authkit-nextjs';",
      );
      writeFileSync(join(testDir, 'middleware.ts'), 'export const authkitMiddleware = () => {};');
      writeFileSync(join(testDir, 'app', 'layout.tsx'), '<AuthKitProvider>');

      const result = await validateInstallation('nextjs', testDir, { runBuild: false });

      const dupIssue = result.issues.find((i) => i.message.includes('different values'));
      expect(dupIssue).toBeUndefined();
    });
  });

  describe('env var alternates validation', () => {
    it('passes when alternate env var (VITE_) is present instead of primary', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-react': '^1.0.0' } }),
      );
      // Using VITE_ prefix instead of WORKOS_CLIENT_ID
      writeFileSync(join(testDir, '.env.local'), 'VITE_WORKOS_CLIENT_ID=client_test_id\n');
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(
        join(testDir, 'src', 'main.tsx'),
        '<AuthKitProvider clientId="client_test"><App /></AuthKitProvider>',
      );

      const result = await validateInstallation('react', testDir, { runBuild: false });

      const envIssue = result.issues.find((i) => i.type === 'env' && i.message.includes('WORKOS_CLIENT_ID'));
      expect(envIssue).toBeUndefined();
    });

    it('passes when alternate env var (REACT_APP_) is present instead of primary', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-react': '^1.0.0' } }),
      );
      // Using REACT_APP_ prefix instead of WORKOS_CLIENT_ID
      writeFileSync(join(testDir, '.env.local'), 'REACT_APP_WORKOS_CLIENT_ID=client_test_id\n');
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(
        join(testDir, 'src', 'main.tsx'),
        '<AuthKitProvider clientId="client_test"><App /></AuthKitProvider>',
      );

      const result = await validateInstallation('react', testDir, { runBuild: false });

      const envIssue = result.issues.find((i) => i.type === 'env' && i.message.includes('WORKOS_CLIENT_ID'));
      expect(envIssue).toBeUndefined();
    });

    it('fails when neither primary nor alternates are present', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-react': '^1.0.0' } }),
      );
      // No WORKOS_CLIENT_ID or any alternate
      writeFileSync(join(testDir, '.env.local'), 'SOME_OTHER_VAR=value\n');
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(
        join(testDir, 'src', 'main.tsx'),
        '<AuthKitProvider clientId="client_test"><App /></AuthKitProvider>',
      );

      const result = await validateInstallation('react', testDir, { runBuild: false });

      const envIssue = result.issues.find((i) => i.type === 'env' && i.message.includes('WORKOS_CLIENT_ID'));
      expect(envIssue).toBeDefined();
      expect(envIssue?.severity).toBe('error');
    });

    it('includes alternates in hint message when missing', async () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ dependencies: { '@workos-inc/authkit-react': '^1.0.0' } }),
      );
      writeFileSync(join(testDir, '.env.local'), 'SOME_OTHER_VAR=value\n');
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(
        join(testDir, 'src', 'main.tsx'),
        '<AuthKitProvider clientId="client_test"><App /></AuthKitProvider>',
      );

      const result = await validateInstallation('react', testDir, { runBuild: false });

      const envIssue = result.issues.find((i) => i.type === 'env' && i.message.includes('WORKOS_CLIENT_ID'));
      expect(envIssue?.hint).toContain('REACT_APP_WORKOS_CLIENT_ID');
      expect(envIssue?.hint).toContain('VITE_WORKOS_CLIENT_ID');
    });
  });
});
