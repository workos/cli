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
  options: ValidateOptions = {}
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
  await validatePackages(rules, projectDir, issues);
  await validateEnvVars(rules, projectDir, issues);
  await validateFiles(rules, projectDir, issues);

  // Run framework-specific cross-validations
  await validateFrameworkSpecific(framework, projectDir, issues);

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

async function validatePackages(rules: ValidationRules, projectDir: string, issues: ValidationIssue[]): Promise<void> {
  const pkgPath = join(projectDir, 'package.json');
  if (!existsSync(pkgPath)) return;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
  } catch {
    // Malformed package.json - skip package validation
    return;
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
}

async function validateEnvVars(rules: ValidationRules, projectDir: string, issues: ValidationIssue[]): Promise<void> {
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
    return;
  }

  for (const rule of rules.envVars) {
    const pattern = new RegExp(`^${rule.name}=.+`, 'm');
    if (!pattern.test(envContent)) {
      issues.push({
        type: 'env',
        severity: rule.required === false ? 'warning' : 'error',
        message: `Missing environment variable: ${rule.name}`,
        hint: `Add ${rule.name}=your_value to .env.local`,
      });
    }
  }
}

async function validateFiles(rules: ValidationRules, projectDir: string, issues: ValidationIssue[]): Promise<void> {
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
}

/**
 * Framework-specific cross-validations that require reading multiple sources.
 */
async function validateFrameworkSpecific(
  framework: string,
  projectDir: string,
  issues: ValidationIssue[]
): Promise<void> {
  switch (framework) {
    case 'nextjs':
      await validateNextjsRedirectUri(projectDir, issues);
      break;
    case 'react-router':
      await validateReactRouterRedirectUri(projectDir, issues);
      break;
    case 'tanstack-start':
      await validateTanstackStartRedirectUri(projectDir, issues);
      break;
  }
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
    const existingRoutes = await fg(['app/**/callback/**/route.{ts,tsx,js,jsx}', 'src/app/**/callback/**/route.{ts,tsx,js,jsx}'], {
      cwd: projectDir,
    });

    let hint = `Create a route handler at app/${routePath}/route.ts`;
    if (existingRoutes.length > 0) {
      // Found a route at a different path - likely the mismatch
      const actualPath = '/' + existingRoutes[0].replace(/^(src\/)?app\//, '').replace(/\/route\.(ts|tsx|js|jsx)$/, '');
      hint = `Found callback route at ${existingRoutes[0]} but redirect URI points to ${callbackPath}. Either:\n` +
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
      const actualPath = '/' + actualFile
        .replace(/^app\/routes\//, '')
        .replace(/\.(tsx?|jsx?)$/, '')
        .replace(/\/(index|route)$/, '')
        .replace(/\./g, '/');
      hint = `Found callback route at ${actualFile} but redirect URI points to ${callbackPath}. Either:\n` +
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
      const actualPath = '/' + actualFile
        .replace(/^app\/routes\//, '')
        .replace(/\.(tsx?|jsx?)$/, '')
        .replace(/\/index$/, '');
      hint = `Found callback route at ${actualFile} but redirect URI points to ${callbackPath}. Either:\n` +
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
