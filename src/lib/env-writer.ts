import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseEnvFile } from '../utils/env-parser.js';

const ENV_LOCAL_COVERING_PATTERNS = ['.env.local', '.env*.local', '.env*'];
const ENV_COVERING_PATTERNS = ['.env', '.env*'];

/**
 * Ensure the given env filename is in .gitignore.
 * Creates .gitignore if it doesn't exist.
 * No-ops if a covering pattern is already present.
 */
function ensureGitignore(installDir: string, filename: '.env' | '.env.local'): void {
  const gitignorePath = join(installDir, '.gitignore');
  const coveringPatterns = filename === '.env' ? ENV_COVERING_PATTERNS : ENV_LOCAL_COVERING_PATTERNS;

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${filename}\n`);
    return;
  }

  const content = readFileSync(gitignorePath, 'utf-8');
  const lines = content.split('\n').map((line) => line.trim());

  if (lines.some((line) => coveringPatterns.includes(line))) {
    return;
  }

  const separator = content.endsWith('\n') ? '' : '\n';
  writeFileSync(gitignorePath, `${content}${separator}${filename}\n`);
}

interface EnvVars {
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID: string;
  WORKOS_REDIRECT_URI?: string;
  NEXT_PUBLIC_WORKOS_REDIRECT_URI?: string;
  WORKOS_COOKIE_PASSWORD?: string;
  WORKOS_CLAIM_TOKEN?: string;
}

/**
 * Generate a cryptographically secure cookie password.
 * Returns 32-char hex string (16 random bytes).
 * Uses Web Crypto API available in Node.js 20+
 */
function generateCookiePassword(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Write environment variables to .env.local before agent runs.
 * Merges with existing .env.local if present (new vars take precedence).
 * Auto-generates WORKOS_COOKIE_PASSWORD if not provided.
 */
export function writeEnvLocal(installDir: string, envVars: Partial<EnvVars>): void {
  const envPath = join(installDir, '.env.local');

  // Read existing env if present
  let existingEnv: Record<string, string> = {};
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    existingEnv = parseEnvFile(content);
  }

  // Merge with new vars (new vars take precedence)
  const merged = { ...existingEnv, ...envVars };

  // Generate cookie password if not provided
  if (!merged.WORKOS_COOKIE_PASSWORD) {
    merged.WORKOS_COOKIE_PASSWORD = generateCookiePassword();
  }

  // Write back
  const content = Object.entries(merged)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  ensureGitignore(installDir, '.env.local');

  writeFileSync(envPath, content + '\n');
}

/**
 * Write WorkOS credentials to the appropriate env file for the project.
 * Picks `.env.local` for JS projects (package.json present) or `.env` for
 * everything else (Python/Django, Ruby/Rails, Go, ...). Skips cookie password
 * generation outside the JS branch — non-JS SDKs don't use it.
 *
 * Used by pre-detection flows that write credentials before the framework
 * integration is known (unclaimed env provisioning).
 */
export function writeCredentialsEnv(installDir: string, envVars: Partial<EnvVars>): void {
  const hasPackageJson = existsSync(join(installDir, 'package.json'));
  if (hasPackageJson) {
    writeEnvLocal(installDir, envVars);
    return;
  }

  const envPath = join(installDir, '.env');
  let existingEnv: Record<string, string> = {};
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    existingEnv = parseEnvFile(content);
  }

  const merged = { ...existingEnv, ...envVars };
  const content = Object.entries(merged)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  ensureGitignore(installDir, '.env');

  writeFileSync(envPath, content + '\n');
}
