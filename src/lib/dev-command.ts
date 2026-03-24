import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

export interface DevCommandResult {
  command: string;
  args: string[];
  framework: string | null;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Framework-to-dev-command mapping. Checked in order after package.json detection.
 * Each entry maps a dependency name to a framework display name and default dev command.
 */
const FRAMEWORK_DEV_COMMANDS: Array<{
  dep: string;
  framework: string;
  command: string;
  args: string[];
}> = [
  { dep: 'next', framework: 'Next.js', command: 'next', args: ['dev'] },
  { dep: '@remix-run/dev', framework: 'Remix', command: 'remix', args: ['dev'] },
  { dep: 'react-router', framework: 'React Router', command: 'react-router', args: ['dev'] },
  { dep: '@tanstack/react-start', framework: 'TanStack Start', command: 'vinxi', args: ['dev'] },
  { dep: '@sveltejs/kit', framework: 'SvelteKit', command: 'vite', args: ['dev'] },
  { dep: 'vite', framework: 'Vite', command: 'vite', args: ['dev'] },
  { dep: 'nuxt', framework: 'Nuxt', command: 'nuxt', args: ['dev'] },
  { dep: 'express', framework: 'Express', command: 'node', args: ['index.js'] },
];

/**
 * Non-JS framework detection: checks for well-known files in the project directory.
 */
const NON_JS_FRAMEWORKS: Array<{
  file: string;
  framework: string;
  command: string;
  args: string[];
}> = [
  { file: 'manage.py', framework: 'Django', command: 'python', args: ['manage.py', 'runserver'] },
  { file: 'Gemfile', framework: 'Rails', command: 'rails', args: ['server'] },
  { file: 'go.mod', framework: 'Go', command: 'go', args: ['run', '.'] },
];

function readPackageJson(projectDir: string): PackageJson | null {
  const pkgPath = resolve(projectDir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
  } catch {
    return null;
  }
}

function hasDependency(pkg: PackageJson, dep: string): boolean {
  return !!(pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]);
}

/**
 * Resolve the npx-style command for a given binary.
 * Returns the binary path under node_modules/.bin if it exists,
 * otherwise returns the bare command name (assumes it's globally available).
 */
function resolveNodeBin(projectDir: string, command: string): string {
  const binPath = join(projectDir, 'node_modules', '.bin', command);
  if (existsSync(binPath)) return binPath;
  return command;
}

/**
 * Resolve the dev command for a project directory.
 *
 * Priority:
 * 1. `scripts.dev` from package.json (developer's config is authoritative)
 * 2. Framework-specific default based on dependency detection
 * 3. Non-JS framework detection (Django, Rails, Go)
 * 4. Error — no dev command could be resolved
 */
export async function resolveDevCommand(projectDir: string): Promise<DevCommandResult> {
  const pkg = readPackageJson(projectDir);

  if (pkg) {
    // Detect framework from dependencies first (for display purposes)
    let detectedFramework: string | null = null;
    for (const entry of FRAMEWORK_DEV_COMMANDS) {
      if (hasDependency(pkg, entry.dep)) {
        detectedFramework = entry.framework;
        break;
      }
    }

    // Priority 1: scripts.dev from package.json
    if (pkg.scripts?.dev) {
      // Use the package manager's run command to execute scripts.dev
      const packageManager = detectPackageManager(projectDir);
      return {
        command: packageManager,
        args: ['run', 'dev'],
        framework: detectedFramework,
      };
    }

    // Priority 2: Framework-specific default
    for (const entry of FRAMEWORK_DEV_COMMANDS) {
      if (hasDependency(pkg, entry.dep)) {
        return {
          command: resolveNodeBin(projectDir, entry.command),
          args: entry.args,
          framework: entry.framework,
        };
      }
    }
  }

  // Priority 3: Non-JS frameworks
  for (const entry of NON_JS_FRAMEWORKS) {
    if (existsSync(resolve(projectDir, entry.file))) {
      return {
        command: entry.command,
        args: entry.args,
        framework: entry.framework,
      };
    }
  }

  // No framework or scripts.dev found
  return {
    command: 'npm',
    args: ['run', 'dev'],
    framework: null,
  };
}

/**
 * Detect the package manager used in the project.
 */
function detectPackageManager(projectDir: string): string {
  if (existsSync(resolve(projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(resolve(projectDir, 'yarn.lock'))) return 'yarn';
  if (existsSync(resolve(projectDir, 'bun.lockb')) || existsSync(resolve(projectDir, 'bun.lock'))) return 'bun';
  return 'npm';
}

// Export for testing
export { readPackageJson as _readPackageJson, detectPackageManager as _detectPackageManager };
