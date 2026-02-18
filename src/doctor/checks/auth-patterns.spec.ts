import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkAuthPatterns } from './auth-patterns.js';
import type { FrameworkInfo, EnvironmentInfo, SdkInfo, DoctorOptions } from '../types.js';

// --- Fixture helpers ---

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'doctor-auth-patterns-'));
}

function writeFixtureFile(dir: string, relativePath: string, content: string) {
  const fullPath = join(dir, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

function makeOptions(installDir: string): DoctorOptions {
  return { installDir };
}

function makeFramework(overrides: Partial<FrameworkInfo> = {}): FrameworkInfo {
  return { name: null, version: null, ...overrides };
}

function makeEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    apiKeyConfigured: true,
    apiKeyType: 'staging',
    clientId: 'client_test',
    redirectUri: null,
    cookieDomain: null,
    baseUrl: 'https://api.workos.com',
    ...overrides,
  };
}

function makeSdk(overrides: Partial<SdkInfo> = {}): SdkInfo {
  return { name: '@workos-inc/authkit-nextjs', version: '1.0.0', latest: '1.0.0', outdated: false, isAuthKit: true, ...overrides };
}

// --- Tests ---

describe('checkAuthPatterns', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('SIGNOUT_GET_HANDLER', () => {
    it('detects export function GET in signout route', async () => {
      writeFixtureFile(testDir, 'app/signout/route.ts', 'export function GET() { return signOut(); }');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      const finding = result.findings.find((f) => f.code === 'SIGNOUT_GET_HANDLER');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
      expect(finding!.filePath).toBe('app/signout/route.ts');
    });

    it('detects export async function GET in logout route', async () => {
      writeFixtureFile(testDir, 'app/logout/route.ts', 'export async function GET() { return signOut(); }');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'SIGNOUT_GET_HANDLER')).toBeDefined();
    });

    it('detects export const GET in sign-out route', async () => {
      writeFixtureFile(testDir, 'app/sign-out/route.ts', 'export const GET = () => signOut();');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'SIGNOUT_GET_HANDLER')).toBeDefined();
    });

    it('no finding for POST signout route', async () => {
      writeFixtureFile(testDir, 'app/signout/route.ts', 'export function POST() { return signOut(); }');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'SIGNOUT_GET_HANDLER')).toBeUndefined();
    });

    it('no finding when signout route does not exist', async () => {
      writeFixtureFile(testDir, 'app/dashboard/route.ts', 'export function GET() {}');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'SIGNOUT_GET_HANDLER')).toBeUndefined();
    });

    it('works with src/app prefix', async () => {
      writeFixtureFile(testDir, 'src/app/signout/route.ts', 'export function GET() {}');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'SIGNOUT_GET_HANDLER')).toBeDefined();
    });
  });

  describe('SIGNOUT_LINK_PREFETCH', () => {
    it('detects Link href to /signout', async () => {
      writeFixtureFile(testDir, 'app/layout.tsx', '<Link href="/signout">Sign Out</Link>');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'SIGNOUT_LINK_PREFETCH')).toBeDefined();
    });

    it('detects NextLink alias href to /signout', async () => {
      writeFixtureFile(testDir, 'app/layout.tsx', '<NextLink href="/signout">Sign Out</NextLink>');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'SIGNOUT_LINK_PREFETCH')).toBeDefined();
    });

    it('detects Link href to /logout', async () => {
      writeFixtureFile(testDir, 'app/nav.tsx', '<Link href="/logout">Log Out</Link>');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'SIGNOUT_LINK_PREFETCH')).toBeDefined();
    });

    it('no finding for <a> tag to /signout', async () => {
      writeFixtureFile(testDir, 'app/nav.tsx', '<a href="/signout">Sign Out</a>');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'SIGNOUT_LINK_PREFETCH')).toBeUndefined();
    });

    it('no finding for Link to /dashboard', async () => {
      writeFixtureFile(testDir, 'app/nav.tsx', '<Link href="/dashboard">Dashboard</Link>');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'SIGNOUT_LINK_PREFETCH')).toBeUndefined();
    });
  });

  describe('MISSING_MIDDLEWARE', () => {
    it('error when no middleware or proxy exists', async () => {
      writeFixtureFile(testDir, 'app/page.tsx', 'export default function Home() {}');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'MISSING_MIDDLEWARE')).toBeDefined();
    });

    it('no finding when middleware.ts exists at root', async () => {
      writeFixtureFile(testDir, 'middleware.ts', 'export { authkitMiddleware } from "@workos-inc/authkit-nextjs"');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'MISSING_MIDDLEWARE')).toBeUndefined();
    });

    it('no finding when proxy.ts exists at src/', async () => {
      writeFixtureFile(testDir, 'src/proxy.ts', 'export { authkitMiddleware } from "@workos-inc/authkit-nextjs"');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'MISSING_MIDDLEWARE')).toBeUndefined();
    });
  });

  describe('MIDDLEWARE_WRONG_LOCATION', () => {
    it('warning when middleware.ts inside app/', async () => {
      writeFixtureFile(testDir, 'app/middleware.ts', 'export default function middleware() {}');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'MIDDLEWARE_WRONG_LOCATION')).toBeDefined();
    });

    it('no finding when middleware.ts at root', async () => {
      writeFixtureFile(testDir, 'middleware.ts', 'export default function middleware() {}');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'MIDDLEWARE_WRONG_LOCATION')).toBeUndefined();
    });
  });

  describe('MISSING_AUTHKIT_PROVIDER', () => {
    it('warning when layout.tsx lacks AuthKitProvider (Next.js)', async () => {
      writeFixtureFile(testDir, 'app/layout.tsx', 'export default function Layout({ children }) { return <html>{children}</html> }');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'MISSING_AUTHKIT_PROVIDER')).toBeDefined();
    });

    it('no finding when layout.tsx contains AuthKitProvider', async () => {
      writeFixtureFile(testDir, 'app/layout.tsx', '<AuthKitProvider>{children}</AuthKitProvider>');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'MISSING_AUTHKIT_PROVIDER')).toBeUndefined();
    });
  });

  describe('CALLBACK_ROUTE_MISSING', () => {
    it('error when redirect URI set but no callback route (Next.js)', async () => {
      writeFixtureFile(testDir, 'app/page.tsx', 'export default function Home() {}');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'CALLBACK_ROUTE_MISSING')).toBeDefined();
    });

    it('no finding when callback route exists (Next.js)', async () => {
      writeFixtureFile(testDir, 'app/auth/callback/route.ts', 'export { handleAuth as GET } from "@workos-inc/authkit-nextjs"');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'CALLBACK_ROUTE_MISSING')).toBeUndefined();
    });

    it('resolves callback path from NEXT_PUBLIC_WORKOS_REDIRECT_URI', async () => {
      writeFixtureFile(testDir, '.env.local', 'NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback');
      writeFixtureFile(testDir, 'app/callback/route.ts', 'export { handleAuth as GET } from "@workos-inc/authkit-nextjs"');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk(),
      );
      // Should NOT report missing — the env var overrides the default path
      expect(result.findings.find((f) => f.code === 'CALLBACK_ROUTE_MISSING')).toBeUndefined();
    });

    it('reports missing when env redirect URI path has no route', async () => {
      writeFixtureFile(testDir, '.env.local', 'NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/custom/callback');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'CALLBACK_ROUTE_MISSING')).toBeDefined();
    });

    it('no finding when no callback path configured', async () => {
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'CALLBACK_ROUTE_MISSING')).toBeUndefined();
    });

    it('error when callback route missing (React Router flat)', async () => {
      writeFixtureFile(testDir, 'app/routes/_index.tsx', 'export default function Home() {}');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'React Router', version: '7.0.0', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-react-router' }),
      );
      expect(result.findings.find((f) => f.code === 'CALLBACK_ROUTE_MISSING')).toBeDefined();
    });

    it('no finding when callback route exists (React Router flat)', async () => {
      writeFixtureFile(testDir, 'app/routes/auth.callback.tsx', 'export { authLoader as loader } from "@workos-inc/authkit-react-router"');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'React Router', version: '7.0.0', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-react-router' }),
      );
      expect(result.findings.find((f) => f.code === 'CALLBACK_ROUTE_MISSING')).toBeUndefined();
    });

    it('no finding when callback route exists (TanStack Start flat)', async () => {
      writeFixtureFile(testDir, 'src/routes/auth.callback.tsx', 'export const Route = createFileRoute("/auth/callback")');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'TanStack Start', version: '1.0.0', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-tanstack-start' }),
      );
      expect(result.findings.find((f) => f.code === 'CALLBACK_ROUTE_MISSING')).toBeUndefined();
    });
  });

  describe('API_KEY_LEAKED_TO_CLIENT', () => {
    it('error when NEXT_PUBLIC_WORKOS_API_KEY in .env.local', async () => {
      writeFixtureFile(testDir, '.env.local', 'NEXT_PUBLIC_WORKOS_API_KEY=sk_test_abc123');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js' }),
        makeEnv(),
        makeSdk(),
      );
      const finding = result.findings.find((f) => f.code === 'API_KEY_LEAKED_TO_CLIENT');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
    });

    it('error when VITE_WORKOS_API_KEY in .env', async () => {
      writeFixtureFile(testDir, '.env', 'VITE_WORKOS_API_KEY=sk_live_abc123');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'API_KEY_LEAKED_TO_CLIENT')).toBeDefined();
    });

    it('no finding for server-only WORKOS_API_KEY', async () => {
      writeFixtureFile(testDir, '.env.local', 'WORKOS_API_KEY=sk_test_abc123');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'API_KEY_LEAKED_TO_CLIENT')).toBeUndefined();
    });

    it('no finding for NEXT_PUBLIC_WORKOS_CLIENT_ID (not a secret)', async () => {
      writeFixtureFile(testDir, '.env.local', 'NEXT_PUBLIC_WORKOS_CLIENT_ID=client_test_abc');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'API_KEY_LEAKED_TO_CLIENT')).toBeUndefined();
    });

    it('detects REACT_APP_WORKOS_API_KEY', async () => {
      writeFixtureFile(testDir, '.env', 'REACT_APP_WORKOS_API_KEY=sk_test_abc123');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'React Router' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-react-router' }),
      );
      expect(result.findings.find((f) => f.code === 'API_KEY_LEAKED_TO_CLIENT')).toBeDefined();
    });
  });

  describe('WRONG_CALLBACK_LOADER', () => {
    it('warning when callback uses authkitLoader instead of authLoader', async () => {
      writeFixtureFile(testDir, 'app/routes/auth.callback.tsx', `
        import { authkitLoader } from "@workos-inc/authkit-react-router";
        export const loader = authkitLoader;
      `);
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'React Router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-react-router' }),
      );
      expect(result.findings.find((f) => f.code === 'WRONG_CALLBACK_LOADER')).toBeDefined();
    });

    it('no finding when callback uses authLoader', async () => {
      writeFixtureFile(testDir, 'app/routes/auth.callback.tsx', `
        import { authLoader } from "@workos-inc/authkit-react-router";
        export const loader = authLoader;
      `);
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'React Router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-react-router' }),
      );
      expect(result.findings.find((f) => f.code === 'WRONG_CALLBACK_LOADER')).toBeUndefined();
    });
  });

  describe('MISSING_ROOT_AUTH_LOADER', () => {
    it('warning when root route lacks authkitLoader', async () => {
      writeFixtureFile(testDir, 'app/root.tsx', 'export default function Root() { return <html></html> }');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'React Router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-react-router' }),
      );
      expect(result.findings.find((f) => f.code === 'MISSING_ROOT_AUTH_LOADER')).toBeDefined();
    });

    it('no finding when root route uses authkitLoader', async () => {
      writeFixtureFile(testDir, 'app/root.tsx', `
        import { authkitLoader } from "@workos-inc/authkit-react-router";
        export const loader = authkitLoader;
      `);
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'React Router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-react-router' }),
      );
      expect(result.findings.find((f) => f.code === 'MISSING_ROOT_AUTH_LOADER')).toBeUndefined();
    });
  });

  describe('MISSING_AUTHKIT_MIDDLEWARE (TanStack Start)', () => {
    it('warning when start.ts lacks authkitMiddleware', async () => {
      writeFixtureFile(testDir, 'src/start.ts', 'export default defineStart({})');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'TanStack Start', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-tanstack-start' }),
      );
      expect(result.findings.find((f) => f.code === 'MISSING_AUTHKIT_MIDDLEWARE')).toBeDefined();
    });

    it('no finding when start.ts references authkitMiddleware', async () => {
      writeFixtureFile(testDir, 'src/start.ts', `
        import { authkitMiddleware } from "@workos-inc/authkit-tanstack-start";
        export default defineStart({ middleware: [authkitMiddleware()] });
      `);
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'TanStack Start', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-tanstack-start' }),
      );
      expect(result.findings.find((f) => f.code === 'MISSING_AUTHKIT_MIDDLEWARE')).toBeUndefined();
    });
  });

  describe('COOKIE_PASSWORD_TOO_SHORT', () => {
    it('warning when password is too short', async () => {
      writeFixtureFile(testDir, '.env.local', 'WORKOS_COOKIE_PASSWORD=tooshort');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'React Router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-react-router' }),
      );
      const finding = result.findings.find((f) => f.code === 'COOKIE_PASSWORD_TOO_SHORT');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
    });

    it('no finding when password is 32+ chars', async () => {
      writeFixtureFile(testDir, '.env.local', 'WORKOS_COOKIE_PASSWORD=supersecretpasswordthatis32chars!');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'React Router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-react-router' }),
      );
      expect(result.findings.find((f) => f.code === 'COOKIE_PASSWORD_TOO_SHORT')).toBeUndefined();
    });

    it('no finding when password not set', async () => {
      writeFixtureFile(testDir, '.env.local', 'WORKOS_API_KEY=sk_test_abc');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'TanStack Start', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-tanstack-start' }),
      );
      expect(result.findings.find((f) => f.code === 'COOKIE_PASSWORD_TOO_SHORT')).toBeUndefined();
    });

    it('not checked for Next.js', async () => {
      writeFixtureFile(testDir, '.env.local', 'WORKOS_COOKIE_PASSWORD=short');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings.find((f) => f.code === 'COOKIE_PASSWORD_TOO_SHORT')).toBeUndefined();
    });
  });

  describe('checksRun count', () => {
    it('returns correct count for Next.js', async () => {
      writeFixtureFile(testDir, 'middleware.ts', 'export {}');
      writeFixtureFile(testDir, 'app/layout.tsx', '<AuthKitProvider>{children}</AuthKitProvider>');
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router' }),
        makeEnv(),
        makeSdk(),
      );
      // 1 cross-framework + 6 Next.js = 7
      expect(result.checksRun).toBe(7);
    });

    it('returns correct count for React Router', async () => {
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'React Router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-react-router' }),
      );
      // 1 cross-framework + 5 React Router = 6
      expect(result.checksRun).toBe(6);
    });

    it('returns correct count for TanStack Start', async () => {
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'TanStack Start', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/authkit-tanstack-start' }),
      );
      // 1 cross-framework + 3 TanStack = 4
      expect(result.checksRun).toBe(4);
    });

    it('returns only cross-framework for unknown framework', async () => {
      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Express' }),
        makeEnv(),
        makeSdk({ name: '@workos-inc/node' }),
      );
      expect(result.checksRun).toBe(1);
    });
  });

  describe('integration', () => {
    it('returns no findings for a correctly configured Next.js project', async () => {
      writeFixtureFile(testDir, 'middleware.ts', 'export { authkitMiddleware } from "@workos-inc/authkit-nextjs"');
      writeFixtureFile(testDir, 'app/layout.tsx', '<AuthKitProvider>{children}</AuthKitProvider>');
      writeFixtureFile(testDir, 'app/auth/callback/route.ts', 'export { handleAuth as GET } from "@workos-inc/authkit-nextjs"');
      writeFixtureFile(testDir, '.env.local', 'WORKOS_API_KEY=sk_test_abc\nWORKOS_CLIENT_ID=client_test');

      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk(),
      );
      expect(result.findings).toHaveLength(0);
    });

    it('returns multiple findings for a misconfigured project', async () => {
      writeFixtureFile(testDir, 'app/signout/route.ts', 'export function GET() { return signOut(); }');
      writeFixtureFile(testDir, 'app/layout.tsx', '<Link href="/signout">Sign Out</Link>');
      writeFixtureFile(testDir, '.env.local', 'NEXT_PUBLIC_WORKOS_API_KEY=sk_test_abc');

      const result = await checkAuthPatterns(
        makeOptions(testDir),
        makeFramework({ name: 'Next.js', variant: 'app-router', expectedCallbackPath: '/auth/callback' }),
        makeEnv(),
        makeSdk(),
      );

      const codes = result.findings.map((f) => f.code);
      expect(codes).toContain('SIGNOUT_GET_HANDLER');
      expect(codes).toContain('SIGNOUT_LINK_PREFETCH');
      expect(codes).toContain('MISSING_MIDDLEWARE');
      expect(codes).toContain('MISSING_AUTHKIT_PROVIDER');
      expect(codes).toContain('CALLBACK_ROUTE_MISSING');
      expect(codes).toContain('API_KEY_LEAKED_TO_CLIENT');
    });
  });
});
