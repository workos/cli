import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import fg from 'fast-glob';
import type { ValidationResult, ValidationRules, ValidationIssue } from './types.js';
import { runBuildValidation } from './build-validator.js';

export interface ValidateOptions {
  variant?: string;
  runBuild?: boolean;
}

export async function validateInstallation(
  framework: string,
  projectDir: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const startTime = Date.now();
  const issues: ValidationIssue[] = [];

  // Load rules for framework (with optional variant)
  const rules = await loadRules(framework, options.variant);
  if (!rules) {
    return {
      passed: true,
      framework,
      issues: [],
      durationMs: Date.now() - startTime,
    };
  }

  // Run validations
  issues.push(...(await validatePackages(rules, projectDir)));
  issues.push(...(await validateEnvVars(rules, projectDir)));
  issues.push(...(await validateFiles(rules, projectDir)));

  // Run framework-specific cross-validations
  issues.push(...(await validateFrameworkSpecific(framework, projectDir)));

  // Run build validation if enabled
  if (options.runBuild !== false) {
    const buildResult = await runBuildValidation(projectDir);
    issues.push(...buildResult.issues);
  }

  return {
    passed: issues.filter((i) => i.severity === 'error').length === 0,
    framework,
    issues,
    durationMs: Date.now() - startTime,
  };
}

async function loadRules(framework: string, variant?: string): Promise<ValidationRules | null> {
  const rulesPath = new URL(`./rules/${framework}.json`, import.meta.url);
  try {
    const content = await readFile(rulesPath, 'utf-8');
    const rules = JSON.parse(content) as ValidationRules;

    // Merge variant rules if specified
    if (variant && rules.variants?.[variant]) {
      const variantRules = rules.variants[variant];
      return {
        ...rules,
        files: [...rules.files, ...(variantRules.files || [])],
        packages: [...rules.packages, ...(variantRules.packages || [])],
        envVars: [...rules.envVars, ...(variantRules.envVars || [])],
      };
    }

    return rules;
  } catch {
    return null; // No rules for this framework yet
  }
}

export async function validatePackages(rules: ValidationRules, projectDir: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const pkgPath = join(projectDir, 'package.json');
  if (!existsSync(pkgPath)) return issues;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
  } catch {
    // Malformed package.json - skip package validation
    return issues;
  }

  const deps = (pkg.dependencies || {}) as Record<string, string>;
  const devDeps = (pkg.devDependencies || {}) as Record<string, string>;
  const allDeps = { ...devDeps, ...deps };

  for (const rule of rules.packages) {
    const location = rule.location || 'any';
    const searchIn = location === 'any' ? allDeps : location === 'dependencies' ? deps : devDeps;

    if (!searchIn[rule.name]) {
      issues.push({
        type: 'package',
        severity: 'error',
        message: `Missing package: ${rule.name}`,
        hint: `Run: npm install ${rule.name}`,
      });
    }
  }

  return issues;
}

export async function validateEnvVars(rules: ValidationRules, projectDir: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const envPath = join(projectDir, '.env.local');
  let envContent = '';

  try {
    envContent = await readFile(envPath, 'utf-8');
  } catch {
    if (rules.envVars.length > 0) {
      issues.push({
        type: 'env',
        severity: 'error',
        message: 'Missing .env.local file',
        hint: 'Create .env.local with required environment variables',
      });
    }
    return issues;
  }

  for (const rule of rules.envVars) {
    // Check primary name and any alternates
    const varsToCheck = [rule.name, ...(rule.alternates || [])];
    const found = varsToCheck.some((varName) => {
      const pattern = new RegExp(`^${varName}=.+`, 'm');
      return pattern.test(envContent);
    });

    if (!found) {
      const hint = rule.alternates
        ? `Add ${rule.name} (or one of: ${rule.alternates.join(', ')}) to .env.local`
        : `Add ${rule.name}=your_value to .env.local`;

      issues.push({
        type: 'env',
        severity: rule.required === false ? 'warning' : 'error',
        message: `Missing environment variable: ${rule.name}`,
        hint,
      });
    }
  }

  return issues;
}

export async function validateFiles(rules: ValidationRules, projectDir: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  for (const rule of rules.files) {
    let matches: string[];
    try {
      matches = await fg(rule.path, { cwd: projectDir });
    } catch {
      // Invalid glob pattern - skip
      continue;
    }

    if (matches.length === 0) {
      issues.push({
        type: 'file',
        severity: 'error',
        message: `Missing file: ${rule.path}`,
        hint: `Create ${rule.path}`,
      });
      continue;
    }

    // Check content patterns
    if (rule.mustContain || rule.mustContainAny) {
      const filePath = join(projectDir, matches[0]);
      let content: string;
      try {
        content = await readFile(filePath, 'utf-8');
      } catch {
        // File read error - skip content checks
        continue;
      }

      // All must be present
      if (rule.mustContain) {
        for (const pattern of rule.mustContain) {
          if (!content.includes(pattern)) {
            issues.push({
              type: 'pattern',
              severity: 'warning',
              message: `File ${matches[0]} missing expected pattern: "${pattern}"`,
              hint: `Ensure ${matches[0]} contains: ${pattern}`,
            });
          }
        }
      }

      // At least one must be present
      if (rule.mustContainAny) {
        const hasAny = rule.mustContainAny.some((p) => content.includes(p));
        if (!hasAny) {
          issues.push({
            type: 'pattern',
            severity: 'warning',
            message: `File ${matches[0]} missing one of: ${rule.mustContainAny.join(', ')}`,
            hint: `Ensure ${matches[0]} contains one of these patterns`,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Framework-specific cross-validations that require reading multiple sources.
 */
export async function validateFrameworkSpecific(framework: string, projectDir: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // Universal cross-validations
  await validateCredentialFormats(projectDir, issues);
  await validateDuplicateEnvVars(projectDir, issues);

  // Framework-specific validations
  switch (framework) {
    case 'nextjs':
      await validateNextjsRedirectUri(projectDir, issues);
      await validateNextjsMiddlewarePlacement(projectDir, issues);
      await validateCookiePasswordLength(projectDir, issues, 'WORKOS_COOKIE_PASSWORD');
      break;
    case 'react':
      await validateReactProviderWrapping(projectDir, issues);
      break;
    case 'react-router':
      await validateReactRouterRedirectUri(projectDir, issues);
      await validateCookiePasswordLength(projectDir, issues, 'WORKOS_COOKIE_PASSWORD');
      break;
    case 'tanstack-start':
      await validateTanstackStartRedirectUri(projectDir, issues);
      await validateCookiePasswordLength(projectDir, issues, 'WORKOS_COOKIE_PASSWORD');
      break;
  }

  return issues;
}

/**
 * Validates that the Next.js redirect URI matches an existing callback route.
 *
 * Common failure: .env.local has /auth/callback but route is at /api/auth/callback
 */
async function validateNextjsRedirectUri(projectDir: string, issues: ValidationIssue[]): Promise<void> {
  const envPath = join(projectDir, '.env.local');
  let envContent: string;

  try {
    envContent = await readFile(envPath, 'utf-8');
  } catch {
    return; // No .env.local - other validators handle this
  }

  // Extract redirect URI value
  const match = envContent.match(/^NEXT_PUBLIC_WORKOS_REDIRECT_URI=(.+)$/m);
  if (!match) {
    return; // Missing env var - other validators handle this
  }

  const redirectUri = match[1].trim();
  let callbackPath: string;

  try {
    const url = new URL(redirectUri);
    callbackPath = url.pathname;
  } catch {
    issues.push({
      type: 'env',
      severity: 'error',
      message: `Invalid redirect URI: ${redirectUri}`,
      hint: 'NEXT_PUBLIC_WORKOS_REDIRECT_URI must be a valid URL',
    });
    return;
  }

  // Remove leading slash for path matching
  const routePath = callbackPath.replace(/^\//, '');

  // Check if route file exists at expected location (Next.js App Router)
  const routePatterns = [
    `app/${routePath}/route.ts`,
    `app/${routePath}/route.tsx`,
    `app/${routePath}/route.js`,
    `app/${routePath}/route.jsx`,
    `src/app/${routePath}/route.ts`,
    `src/app/${routePath}/route.tsx`,
    `src/app/${routePath}/route.js`,
    `src/app/${routePath}/route.jsx`,
  ];

  const routeExists = routePatterns.some((pattern) => existsSync(join(projectDir, pattern)));

  if (!routeExists) {
    // Check what routes DO exist to give a better hint
    const existingRoutes = await fg(
      ['app/**/callback/**/route.{ts,tsx,js,jsx}', 'src/app/**/callback/**/route.{ts,tsx,js,jsx}'],
      {
        cwd: projectDir,
      },
    );

    let hint = `Create a route handler at app/${routePath}/route.ts`;
    if (existingRoutes.length > 0) {
      // Found a route at a different path - likely the mismatch
      const actualPath = '/' + existingRoutes[0].replace(/^(src\/)?app\//, '').replace(/\/route\.(ts|tsx|js|jsx)$/, '');
      hint =
        `Found callback route at ${existingRoutes[0]} but redirect URI points to ${callbackPath}. Either:\n` +
        `  1. Change NEXT_PUBLIC_WORKOS_REDIRECT_URI to http://localhost:3000${actualPath}\n` +
        `  2. Move the route to app/${routePath}/route.ts`;
    }

    issues.push({
      type: 'file',
      severity: 'error',
      message: `Redirect URI path "${callbackPath}" has no matching route file`,
      hint,
    });
  }
}

/**
 * Validates that the React Router redirect URI matches an existing callback route.
 *
 * React Router v7 framework mode uses file-based routing:
 * - /auth/callback → app/routes/auth.callback.tsx (dot notation)
 * - /auth/callback → app/routes/auth/callback.tsx (nested folders)
 */
async function validateReactRouterRedirectUri(projectDir: string, issues: ValidationIssue[]): Promise<void> {
  const envPath = join(projectDir, '.env.local');
  let envContent: string;

  try {
    envContent = await readFile(envPath, 'utf-8');
  } catch {
    return;
  }

  const match = envContent.match(/^WORKOS_REDIRECT_URI=(.+)$/m);
  if (!match) {
    return;
  }

  const redirectUri = match[1].trim();
  let callbackPath: string;

  try {
    const url = new URL(redirectUri);
    callbackPath = url.pathname;
  } catch {
    issues.push({
      type: 'env',
      severity: 'error',
      message: `Invalid redirect URI: ${redirectUri}`,
      hint: 'WORKOS_REDIRECT_URI must be a valid URL',
    });
    return;
  }

  const routePath = callbackPath.replace(/^\//, '');
  // React Router uses dot notation: /auth/callback → auth.callback
  const dotPath = routePath.replace(/\//g, '.');

  // Check possible route file locations
  const routePatterns = [
    // Dot notation (e.g., app/routes/auth.callback.tsx)
    `app/routes/${dotPath}.tsx`,
    `app/routes/${dotPath}.ts`,
    `app/routes/${dotPath}.jsx`,
    `app/routes/${dotPath}.js`,
    // Nested folders (e.g., app/routes/auth/callback.tsx)
    `app/routes/${routePath}.tsx`,
    `app/routes/${routePath}.ts`,
    `app/routes/${routePath}.jsx`,
    `app/routes/${routePath}.js`,
    // Index file in folder (e.g., app/routes/auth/callback/index.tsx)
    `app/routes/${routePath}/index.tsx`,
    `app/routes/${routePath}/index.ts`,
    `app/routes/${routePath}/index.jsx`,
    `app/routes/${routePath}/index.js`,
    // Route file in folder (e.g., app/routes/auth/callback/route.tsx)
    `app/routes/${routePath}/route.tsx`,
    `app/routes/${routePath}/route.ts`,
    `app/routes/${routePath}/route.jsx`,
    `app/routes/${routePath}/route.js`,
  ];

  const routeExists = routePatterns.some((pattern) => existsSync(join(projectDir, pattern)));

  if (!routeExists) {
    const existingRoutes = await fg(['app/routes/**/*callback*.{ts,tsx,js,jsx}'], {
      cwd: projectDir,
    });

    let hint = `Create a route at app/routes/${dotPath}.tsx`;
    if (existingRoutes.length > 0) {
      const actualFile = existingRoutes[0];
      // Convert file path back to URL path
      const actualPath =
        '/' +
        actualFile
          .replace(/^app\/routes\//, '')
          .replace(/\.(tsx?|jsx?)$/, '')
          .replace(/\/(index|route)$/, '')
          .replace(/\./g, '/');
      hint =
        `Found callback route at ${actualFile} but redirect URI points to ${callbackPath}. Either:\n` +
        `  1. Change WORKOS_REDIRECT_URI to http://localhost:3000${actualPath}\n` +
        `  2. Move the route to app/routes/${dotPath}.tsx`;
    }

    issues.push({
      type: 'file',
      severity: 'error',
      message: `Redirect URI path "${callbackPath}" has no matching route file`,
      hint,
    });
  }
}

/**
 * Validates that the TanStack Start redirect URI matches an existing callback route.
 *
 * TanStack Start uses file-based routing:
 * - /auth/callback → app/routes/auth/callback.tsx
 */
async function validateTanstackStartRedirectUri(projectDir: string, issues: ValidationIssue[]): Promise<void> {
  const envPath = join(projectDir, '.env.local');
  let envContent: string;

  try {
    envContent = await readFile(envPath, 'utf-8');
  } catch {
    return;
  }

  const match = envContent.match(/^WORKOS_REDIRECT_URI=(.+)$/m);
  if (!match) {
    return;
  }

  const redirectUri = match[1].trim();
  let callbackPath: string;

  try {
    const url = new URL(redirectUri);
    callbackPath = url.pathname;
  } catch {
    issues.push({
      type: 'env',
      severity: 'error',
      message: `Invalid redirect URI: ${redirectUri}`,
      hint: 'WORKOS_REDIRECT_URI must be a valid URL',
    });
    return;
  }

  const routePath = callbackPath.replace(/^\//, '');

  // TanStack Start route patterns
  const routePatterns = [
    `app/routes/${routePath}.tsx`,
    `app/routes/${routePath}.ts`,
    `app/routes/${routePath}.jsx`,
    `app/routes/${routePath}.js`,
    `app/routes/${routePath}/index.tsx`,
    `app/routes/${routePath}/index.ts`,
    `app/routes/${routePath}/index.jsx`,
    `app/routes/${routePath}/index.js`,
  ];

  const routeExists = routePatterns.some((pattern) => existsSync(join(projectDir, pattern)));

  if (!routeExists) {
    const existingRoutes = await fg(['app/routes/**/*callback*.{ts,tsx,js,jsx}'], {
      cwd: projectDir,
    });

    let hint = `Create a route at app/routes/${routePath}.tsx`;
    if (existingRoutes.length > 0) {
      const actualFile = existingRoutes[0];
      const actualPath =
        '/' +
        actualFile
          .replace(/^app\/routes\//, '')
          .replace(/\.(tsx?|jsx?)$/, '')
          .replace(/\/index$/, '');
      hint =
        `Found callback route at ${actualFile} but redirect URI points to ${callbackPath}. Either:\n` +
        `  1. Change WORKOS_REDIRECT_URI to http://localhost:3000${actualPath}\n` +
        `  2. Move the route to app/routes/${routePath}.tsx`;
    }

    issues.push({
      type: 'file',
      severity: 'error',
      message: `Redirect URI path "${callbackPath}" has no matching route file`,
      hint,
    });
  }
}

/**
 * Validates cookie password is at least 32 characters.
 * WorkOS requires this for secure session encryption.
 */
async function validateCookiePasswordLength(
  projectDir: string,
  issues: ValidationIssue[],
  envVarName: string,
): Promise<void> {
  const envPath = join(projectDir, '.env.local');
  let envContent: string;

  try {
    envContent = await readFile(envPath, 'utf-8');
  } catch {
    return; // No .env.local - other validators handle this
  }

  const match = envContent.match(new RegExp(`^${envVarName}=(.*)$`, 'm'));
  if (!match) {
    return; // Missing env var - other validators handle this
  }

  const password = match[1].trim();
  if (password.length < 32) {
    issues.push({
      type: 'env',
      severity: 'error',
      message: `${envVarName} must be at least 32 characters (currently ${password.length})`,
      hint: `Generate a secure password: openssl rand -base64 32`,
    });
  }
}

/**
 * Validates credential formats:
 * - API key should start with sk_
 * - Client ID should start with client_
 */
async function validateCredentialFormats(projectDir: string, issues: ValidationIssue[]): Promise<void> {
  const envPath = join(projectDir, '.env.local');
  let envContent: string;

  try {
    envContent = await readFile(envPath, 'utf-8');
  } catch {
    return;
  }

  // Check API key format (any common variation)
  const apiKeyPatterns = [/^WORKOS_API_KEY=(.*)$/m, /^NEXT_PUBLIC_WORKOS_API_KEY=(.*)$/m];

  for (const pattern of apiKeyPatterns) {
    const match = envContent.match(pattern);
    if (match) {
      const value = match[1].trim();
      if (value && !value.startsWith('sk_')) {
        issues.push({
          type: 'env',
          severity: 'error',
          message: `Invalid API key format: "${value.substring(0, 10)}..."`,
          hint: 'WorkOS API keys start with "sk_". Check your WorkOS Dashboard for the correct key.',
        });
      }
    }
  }

  // Check Client ID format
  const clientIdPatterns = [/^WORKOS_CLIENT_ID=(.*)$/m, /^NEXT_PUBLIC_WORKOS_CLIENT_ID=(.*)$/m];

  for (const pattern of clientIdPatterns) {
    const match = envContent.match(pattern);
    if (match) {
      const value = match[1].trim();
      if (value && !value.startsWith('client_')) {
        issues.push({
          type: 'env',
          severity: 'error',
          message: `Invalid Client ID format: "${value.substring(0, 15)}..."`,
          hint: 'WorkOS Client IDs start with "client_". Check your WorkOS Dashboard for the correct ID.',
        });
      }
    }
  }
}

/**
 * Validates Next.js middleware/proxy is at the correct location.
 * Must be alongside the app/ directory — Next.js only watches for these files
 * in the parent directory of app/.
 */
async function validateNextjsMiddlewarePlacement(projectDir: string, issues: ValidationIssue[]): Promise<void> {
  // Determine where app/ lives to know where middleware/proxy should be
  const appInSrc = existsSync(join(projectDir, 'src', 'app'));
  const expectedDir = appInSrc ? 'src/' : '';

  const correctPaths = [
    `${expectedDir}middleware.ts`,
    `${expectedDir}middleware.js`,
    `${expectedDir}proxy.ts`,
    `${expectedDir}proxy.js`,
  ];

  const hasCorrectPlacement = correctPaths.some((p) => existsSync(join(projectDir, p)));
  if (hasCorrectPlacement) {
    return;
  }

  // Check for middleware/proxy at the wrong level
  const allPossible = [
    'middleware.ts',
    'middleware.js',
    'src/middleware.ts',
    'src/middleware.js',
    'proxy.ts',
    'proxy.js',
    'src/proxy.ts',
    'src/proxy.js',
  ];
  const wrongLevel = allPossible.find((p) => existsSync(join(projectDir, p)) && !correctPaths.includes(p));

  if (wrongLevel) {
    const correctLevel = appInSrc ? 'src/' : 'project root';
    issues.push({
      type: 'file',
      severity: 'error',
      message: `${wrongLevel} is at the wrong level — app/ is in ${appInSrc ? 'src/' : 'root'}`,
      hint: `Move it to ${expectedDir}${wrongLevel.replace(/^src\//, '')} (must be alongside app/ directory). Next.js silently ignores middleware/proxy files at the wrong level.`,
    });
    return;
  }

  // Check for deeply misplaced middleware
  const misplaced = await fg(['**/{middleware,proxy}.{ts,js}'], {
    cwd: projectDir,
    ignore: ['node_modules/**'],
  });

  if (misplaced.length > 0) {
    issues.push({
      type: 'file',
      severity: 'error',
      message: `middleware/proxy found at wrong location: ${misplaced[0]}`,
      hint: `Must be at ${expectedDir}middleware.ts or ${expectedDir}proxy.ts (alongside app/ directory).`,
    });
  }
}

/**
 * Validates React SPA has AuthKitProvider wrapping the app.
 */
async function validateReactProviderWrapping(projectDir: string, issues: ValidationIssue[]): Promise<void> {
  // Common entry points for React apps
  const entryPatterns = [
    'src/main.tsx',
    'src/main.jsx',
    'src/index.tsx',
    'src/index.jsx',
    'src/App.tsx',
    'src/App.jsx',
    'app/layout.tsx',
    'app/layout.jsx',
  ];

  let foundProvider = false;

  for (const pattern of entryPatterns) {
    const filePath = join(projectDir, pattern);
    if (!existsSync(filePath)) continue;

    try {
      const content = await readFile(filePath, 'utf-8');
      if (content.includes('AuthKitProvider')) {
        foundProvider = true;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!foundProvider) {
    // Check if package is installed (if not, other validators handle it)
    const pkgPath = join(projectDir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['@workos-inc/authkit-react']) {
          issues.push({
            type: 'pattern',
            severity: 'warning',
            message: 'AuthKitProvider not found in common entry points',
            hint: 'Wrap your app with <AuthKitProvider> in main.tsx or App.tsx. See: https://workos.com/docs/user-management/react/authkit',
          });
        }
      } catch {
        // Malformed package.json - skip
      }
    }
  }
}

/**
 * Detects duplicate env vars between .env and .env.local with different values.
 * This can cause confusing behavior where wrong values are used.
 */
async function validateDuplicateEnvVars(projectDir: string, issues: ValidationIssue[]): Promise<void> {
  const envPath = join(projectDir, '.env');
  const envLocalPath = join(projectDir, '.env.local');

  let envContent: string;
  let envLocalContent: string;

  try {
    envContent = await readFile(envPath, 'utf-8');
  } catch {
    return; // No .env file - no conflict possible
  }

  try {
    envLocalContent = await readFile(envLocalPath, 'utf-8');
  } catch {
    return; // No .env.local - no conflict possible
  }

  // Parse env files into key-value maps
  const parseEnv = (content: string): Map<string, string> => {
    const map = new Map<string, string>();
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match) {
        map.set(match[1], match[2].trim());
      }
    }
    return map;
  };

  const envVars = parseEnv(envContent);
  const envLocalVars = parseEnv(envLocalContent);

  // Check for WorkOS-related vars that differ
  const workosVars = [
    'WORKOS_API_KEY',
    'WORKOS_CLIENT_ID',
    'WORKOS_REDIRECT_URI',
    'WORKOS_COOKIE_PASSWORD',
    'NEXT_PUBLIC_WORKOS_CLIENT_ID',
    'NEXT_PUBLIC_WORKOS_REDIRECT_URI',
  ];

  for (const varName of workosVars) {
    const envValue = envVars.get(varName);
    const localValue = envLocalVars.get(varName);

    if (envValue && localValue && envValue !== localValue) {
      issues.push({
        type: 'env',
        severity: 'warning',
        message: `${varName} has different values in .env and .env.local`,
        hint: `.env.local takes precedence. Remove from .env to avoid confusion, or ensure they match.`,
      });
    }
  }
}
