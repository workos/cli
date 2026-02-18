import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import type { AuthPatternFinding, AuthPatternInfo, FrameworkInfo, EnvironmentInfo, SdkInfo, DoctorOptions } from '../types.js';

// --- Helpers ---

/** Return the first path that exists, or null */
function findFile(paths: string[]): string | null {
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Read file content safely, return null on any error */
function readFileSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Test if a file exists and its content matches a regex */
function fileContains(filePath: string, pattern: RegExp): boolean {
  const content = readFileSafe(filePath);
  if (!content) return false;
  return pattern.test(content);
}

const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist', '.git', 'coverage']);

/**
 * Find files matching a name pattern in a directory tree, limited to maxDepth levels.
 * Skips node_modules, .next, dist, etc.
 */
function findFilesShallow(dir: string, namePattern: RegExp, maxDepth = 3): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  function walk(currentDir: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      const dirents = readdirSync(currentDir, { withFileTypes: true });
      for (const dirent of dirents) {
        const fullPath = join(currentDir, dirent.name);
        if (dirent.isDirectory()) {
          if (!SKIP_DIRS.has(dirent.name)) {
            walk(fullPath, depth + 1);
          }
        } else if (dirent.isFile() && namePattern.test(dirent.name)) {
          results.push(fullPath);
        }
      }
    } catch {
      // Directory unreadable
    }
  }

  walk(dir, 0);
  return results;
}

/** Load all env vars from .env and .env.local files */
function loadProjectEnvRaw(installDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const file of ['.env', '.env.local']) {
    const content = readFileSafe(join(installDir, file));
    if (content) {
      try {
        Object.assign(env, parseDotenv(content));
      } catch {
        // Ignore parse errors
      }
    }
  }
  return env;
}

// --- Check Context ---

interface CheckContext {
  framework: FrameworkInfo;
  environment: EnvironmentInfo;
  sdk: SdkInfo;
  installDir: string;
}

// --- Individual Checks ---

/** Resolve the app directory root (app/ or src/app/) for Next.js */
function resolveAppDir(installDir: string): string | null {
  const srcApp = join(installDir, 'src', 'app');
  if (existsSync(srcApp)) return srcApp;
  const app = join(installDir, 'app');
  if (existsSync(app)) return app;
  return null;
}

function checkSignoutGetHandler(ctx: CheckContext): AuthPatternFinding[] {
  if (ctx.framework.name !== 'Next.js') return [];
  const appDir = resolveAppDir(ctx.installDir);
  if (!appDir) return [];

  const routeFiles = findFilesShallow(appDir, /^route\.(ts|tsx|js|jsx)$/);
  const signoutRoutes = routeFiles.filter((f) => /[/\\](sign-?out|logout)[/\\]/.test(f));

  const findings: AuthPatternFinding[] = [];
  const GET_EXPORT = /export\s+(async\s+)?function\s+GET|export\s+const\s+GET/;

  for (const route of signoutRoutes) {
    if (fileContains(route, GET_EXPORT)) {
      findings.push({
        code: 'SIGNOUT_GET_HANDLER',
        severity: 'error',
        message: 'Signout/logout route uses GET handler — vulnerable to CSRF and prefetch-triggered logouts',
        filePath: relative(ctx.installDir, route),
        remediation: 'Convert to a POST server action. GET routes with side effects are vulnerable to CSRF and will be triggered by Next.js link prefetching.',
        docsUrl: 'https://workos.com/docs/authkit/sign-out',
      });
    }
  }
  return findings;
}

function checkSignoutLinkPrefetch(ctx: CheckContext): AuthPatternFinding[] {
  if (ctx.framework.name !== 'Next.js') return [];
  const appDir = resolveAppDir(ctx.installDir);
  if (!appDir) return [];

  const tsxFiles = findFilesShallow(appDir, /\.(tsx|jsx)$/);
  // Match <Link>, <NextLink>, or other common aliases
  const LINK_PATTERN = /<(?:Next)?Link\s[^>]*href\s*=\s*["'{`/]*(\/sign-?out|\/logout)/;

  const findings: AuthPatternFinding[] = [];
  for (const file of tsxFiles) {
    if (fileContains(file, LINK_PATTERN)) {
      findings.push({
        code: 'SIGNOUT_LINK_PREFETCH',
        severity: 'warning',
        message: 'Link component points to signout/logout — Next.js will prefetch this in production, potentially triggering logouts',
        filePath: relative(ctx.installDir, file),
        remediation: 'Use a <form> with a server action or <button> with onClick handler instead of <Link> for signout.',
      });
    }
  }
  return findings;
}

function checkMissingMiddleware(ctx: CheckContext): AuthPatternFinding[] {
  if (ctx.framework.name !== 'Next.js') return [];

  const middlewarePaths = [
    'middleware.ts', 'middleware.js',
    'proxy.ts', 'proxy.js',
    'src/middleware.ts', 'src/middleware.js',
    'src/proxy.ts', 'src/proxy.js',
  ].map((p) => join(ctx.installDir, p));

  if (findFile(middlewarePaths)) return [];

  return [{
    code: 'MISSING_MIDDLEWARE',
    severity: 'error',
    message: 'No middleware.ts or proxy.ts found — AuthKit session handling requires middleware',
    remediation: 'Create middleware.ts at the project root with authkitMiddleware() from @workos-inc/authkit-nextjs.',
    docsUrl: 'https://workos.com/docs/authkit/nextjs/middleware',
  }];
}

function checkMiddlewareWrongLocation(ctx: CheckContext): AuthPatternFinding[] {
  if (ctx.framework.name !== 'Next.js') return [];

  const wrongPaths = [
    'app/middleware.ts', 'app/middleware.js',
    'src/app/middleware.ts', 'src/app/middleware.js',
  ].map((p) => join(ctx.installDir, p));

  const found = findFile(wrongPaths);
  if (!found) return [];

  return [{
    code: 'MIDDLEWARE_WRONG_LOCATION',
    severity: 'warning',
    message: 'middleware.ts found inside app/ directory — must be at project root or src/',
    filePath: relative(ctx.installDir, found),
    remediation: 'Move middleware.ts to the project root (or src/ if using src/ directory).',
    docsUrl: 'https://workos.com/docs/authkit/nextjs/middleware',
  }];
}

function checkMissingAuthKitProvider(ctx: CheckContext): AuthPatternFinding[] {
  const layoutPaths: string[] = [];

  if (ctx.framework.name === 'Next.js') {
    layoutPaths.push(
      join(ctx.installDir, 'app', 'layout.tsx'),
      join(ctx.installDir, 'app', 'layout.jsx'),
      join(ctx.installDir, 'src', 'app', 'layout.tsx'),
      join(ctx.installDir, 'src', 'app', 'layout.jsx'),
    );
  } else if (ctx.framework.name === 'React Router' && ctx.framework.variant === 'declarative') {
    layoutPaths.push(
      join(ctx.installDir, 'src', 'App.tsx'),
      join(ctx.installDir, 'src', 'App.jsx'),
      join(ctx.installDir, 'app', 'root.tsx'),
      join(ctx.installDir, 'app', 'root.jsx'),
    );
  } else {
    return [];
  }

  const layoutFile = findFile(layoutPaths);
  if (!layoutFile) return []; // Can't check if layout doesn't exist

  if (fileContains(layoutFile, /AuthKitProvider/)) return [];

  return [{
    code: 'MISSING_AUTHKIT_PROVIDER',
    severity: 'warning',
    message: 'AuthKitProvider not found in root layout — required for AuthKit session management',
    filePath: relative(ctx.installDir, layoutFile),
    remediation: 'Wrap your app with <AuthKitProvider> in the root layout.',
    docsUrl: 'https://workos.com/docs/authkit/nextjs/setup',
  }];
}

/** Extract callback path from redirect URI env vars or framework default */
function resolveCallbackPath(ctx: CheckContext): string | null {
  // Check env vars for actual redirect URI (including NEXT_PUBLIC_ variant)
  const projectEnv = loadProjectEnvRaw(ctx.installDir);
  const redirectUri = projectEnv.WORKOS_REDIRECT_URI
    ?? projectEnv.NEXT_PUBLIC_WORKOS_REDIRECT_URI
    ?? ctx.environment.redirectUri;

  if (redirectUri) {
    try {
      return new URL(redirectUri).pathname;
    } catch {
      // Invalid URL, fall through to framework default
    }
  }

  return ctx.framework.expectedCallbackPath ?? null;
}

function checkCallbackRouteMissing(ctx: CheckContext): AuthPatternFinding[] {
  const callbackPath = resolveCallbackPath(ctx);
  if (!callbackPath) return [];

  // Build expected route file paths based on framework
  const possiblePaths: string[] = [];

  if (ctx.framework.name === 'Next.js') {
    // app/auth/callback/route.ts (or src/app/)
    const routeDir = callbackPath.replace(/^\//, ''); // 'auth/callback'
    for (const prefix of ['app', 'src/app']) {
      for (const ext of ['ts', 'tsx', 'js', 'jsx']) {
        possiblePaths.push(join(ctx.installDir, prefix, routeDir, `route.${ext}`));
      }
    }
  } else if (ctx.framework.name === 'React Router') {
    // Flat: app/routes/auth.callback.tsx  Nested: app/routes/auth/callback.tsx
    const segments = callbackPath.replace(/^\//, '').split('/');
    const flat = segments.join('.');
    const nested = segments.join('/');
    for (const ext of ['tsx', 'jsx', 'ts', 'js']) {
      possiblePaths.push(join(ctx.installDir, 'app', 'routes', `${flat}.${ext}`));
      possiblePaths.push(join(ctx.installDir, 'app', 'routes', nested + `.${ext}`));
    }
  } else if (ctx.framework.name === 'TanStack Start') {
    // Modern flat: src/routes/api.auth.callback.tsx  Legacy nested: app/routes/api/auth/callback.tsx
    const segments = callbackPath.replace(/^\//, '').split('/');
    const flat = segments.join('.');
    const nested = segments.join('/');
    for (const ext of ['tsx', 'jsx', 'ts', 'js']) {
      possiblePaths.push(join(ctx.installDir, 'src', 'routes', `${flat}.${ext}`));
      possiblePaths.push(join(ctx.installDir, 'app', 'routes', nested + `.${ext}`));
    }
  }

  if (possiblePaths.length === 0) return [];
  if (findFile(possiblePaths)) return [];

  return [{
    code: 'CALLBACK_ROUTE_MISSING',
    severity: 'error',
    message: `No callback route found at expected path ${callbackPath}`,
    remediation: `Create the callback route handler at the path matching your WORKOS_REDIRECT_URI.`,
    docsUrl: 'https://workos.com/docs/authkit/redirect-uri',
  }];
}

const CLIENT_ENV_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'REACT_APP_', 'EXPO_PUBLIC_'];

function checkApiKeyLeakedToClient(ctx: CheckContext): AuthPatternFinding[] {
  const projectEnv = loadProjectEnvRaw(ctx.installDir);
  const findings: AuthPatternFinding[] = [];

  for (const [key, value] of Object.entries(projectEnv)) {
    const hasClientPrefix = CLIENT_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
    if (!hasClientPrefix) continue;

    const isApiKey = key.includes('WORKOS_API_KEY');
    const isSecretValue = value?.startsWith('sk_test_') || value?.startsWith('sk_live_');

    if (isApiKey || isSecretValue) {
      findings.push({
        code: 'API_KEY_LEAKED_TO_CLIENT',
        severity: 'error',
        message: `Secret API key exposed via client-accessible env var ${key}`,
        remediation: `Remove the client prefix. WORKOS_API_KEY must be server-only (no NEXT_PUBLIC_, VITE_, REACT_APP_, or EXPO_PUBLIC_ prefix).`,
      });
    }
  }
  return findings;
}

function checkWrongCallbackLoader(ctx: CheckContext): AuthPatternFinding[] {
  if (ctx.framework.name !== 'React Router') return [];
  const callbackPath = ctx.framework.expectedCallbackPath;
  if (!callbackPath) return [];

  const segments = callbackPath.replace(/^\//, '').split('/');
  const flat = segments.join('.');
  const nested = segments.join('/');

  const possiblePaths: string[] = [];
  for (const ext of ['tsx', 'jsx', 'ts', 'js']) {
    possiblePaths.push(join(ctx.installDir, 'app', 'routes', `${flat}.${ext}`));
    possiblePaths.push(join(ctx.installDir, 'app', 'routes', nested + `.${ext}`));
  }

  const callbackFile = findFile(possiblePaths);
  if (!callbackFile) return []; // No callback route to check

  // authkitLoader is for regular routes; authLoader is for the callback
  if (fileContains(callbackFile, /authkitLoader/) && !fileContains(callbackFile, /authLoader/)) {
    return [{
      code: 'WRONG_CALLBACK_LOADER',
      severity: 'warning',
      message: 'Callback route uses authkitLoader instead of authLoader',
      filePath: relative(ctx.installDir, callbackFile),
      remediation: 'Use authLoader (not authkitLoader) for the callback route. authkitLoader is for regular routes that need auth context.',
    }];
  }
  return [];
}

function checkMissingRootAuthLoader(ctx: CheckContext): AuthPatternFinding[] {
  if (ctx.framework.name !== 'React Router') return [];

  const rootPaths = [
    'app/root.tsx', 'app/root.jsx',
    'app/routes/_index.tsx', 'app/routes/_index.jsx',
  ].map((p) => join(ctx.installDir, p));

  const rootFile = findFile(rootPaths);
  if (!rootFile) return [];

  if (fileContains(rootFile, /authkitLoader/)) return [];

  return [{
    code: 'MISSING_ROOT_AUTH_LOADER',
    severity: 'warning',
    message: 'Root route does not use authkitLoader — child routes will not have auth context',
    filePath: relative(ctx.installDir, rootFile),
    remediation: 'Add authkitLoader to your root route so child routes can access auth state.',
  }];
}

function checkMissingAuthkitMiddleware(ctx: CheckContext): AuthPatternFinding[] {
  if (ctx.framework.name !== 'TanStack Start') return [];

  const startPaths = [
    'src/start.ts', 'src/start.tsx',
    'app/start.ts', 'app/start.tsx',
  ].map((p) => join(ctx.installDir, p));

  const startFile = findFile(startPaths);
  if (!startFile) return []; // Can't check if start file doesn't exist

  if (fileContains(startFile, /authkitMiddleware/)) return [];

  return [{
    code: 'MISSING_AUTHKIT_MIDDLEWARE',
    severity: 'warning',
    message: 'start.ts does not reference authkitMiddleware — AuthKit session handling requires it',
    filePath: relative(ctx.installDir, startFile),
    remediation: 'Add authkitMiddleware to your start.ts server middleware configuration.',
  }];
}

function checkCookiePasswordTooShort(ctx: CheckContext): AuthPatternFinding[] {
  if (ctx.framework.name !== 'React Router' && ctx.framework.name !== 'TanStack Start') return [];

  const projectEnv = loadProjectEnvRaw(ctx.installDir);
  const password = projectEnv.WORKOS_COOKIE_PASSWORD;

  // Only warn if password is set but too short; missing password is a separate concern
  if (!password || password.length >= 32) return [];

  return [{
    code: 'COOKIE_PASSWORD_TOO_SHORT',
    severity: 'warning',
    message: `WORKOS_COOKIE_PASSWORD is ${password.length} characters — minimum 32 required for secure encryption`,
    remediation: 'Set WORKOS_COOKIE_PASSWORD to a random string of at least 32 characters.',
  }];
}

// --- Main Entry Point ---

type CheckFn = (ctx: CheckContext) => AuthPatternFinding[];

const CROSS_FRAMEWORK_CHECKS: CheckFn[] = [
  checkApiKeyLeakedToClient,
];

const NEXTJS_CHECKS: CheckFn[] = [
  checkSignoutGetHandler,
  checkSignoutLinkPrefetch,
  checkMissingMiddleware,
  checkMiddlewareWrongLocation,
  checkMissingAuthKitProvider,
  checkCallbackRouteMissing,
];

const REACT_ROUTER_CHECKS: CheckFn[] = [
  checkWrongCallbackLoader,
  checkMissingRootAuthLoader,
  checkMissingAuthKitProvider,
  checkCallbackRouteMissing,
  checkCookiePasswordTooShort,
];

const TANSTACK_CHECKS: CheckFn[] = [
  checkMissingAuthkitMiddleware,
  checkCallbackRouteMissing,
  checkCookiePasswordTooShort,
];

export async function checkAuthPatterns(
  options: DoctorOptions,
  framework: FrameworkInfo,
  environment: EnvironmentInfo,
  sdk: SdkInfo,
): Promise<AuthPatternInfo> {
  const ctx: CheckContext = {
    framework,
    environment,
    sdk,
    installDir: options.installDir,
  };

  const checks: CheckFn[] = [...CROSS_FRAMEWORK_CHECKS];

  switch (framework.name) {
    case 'Next.js':
      checks.push(...NEXTJS_CHECKS);
      break;
    case 'React Router':
      checks.push(...REACT_ROUTER_CHECKS);
      break;
    case 'TanStack Start':
      checks.push(...TANSTACK_CHECKS);
      break;
  }

  const findings: AuthPatternFinding[] = [];
  for (const check of checks) {
    findings.push(...check(ctx));
  }

  return {
    checksRun: checks.length,
    findings,
  };
}
