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
