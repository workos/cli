import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { parseEnvFile } from '../utils/env-parser.js';

const ENV_LOCAL_COVERING_PATTERNS = ['.env.local', '.env*.local', '.env*'];
const ENV_COVERING_PATTERNS = ['.env', '.env*'];

/**
 * Ensure the given filename is in .gitignore.
 * Creates .gitignore if it doesn't exist.
 * No-ops if one of `coveringPatterns` is already present.
 */
function ensureGitignore(installDir: string, filename: string, coveringPatterns: string[]): void {
  const gitignorePath = join(installDir, '.gitignore');

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
 * Set `vars` in `content` without disturbing comments, blank lines, or key order.
 * Existing keys are rewritten in place; new keys are appended.
 *
 * An existing key is rewritten as `key=value` with no leading whitespace even if
 * the original line was indented — indented env lines are vanishingly rare and
 * preserving the indent adds branching for no real benefit.
 *
 * Key extraction splits on the first `=`, matching `parseEnvFile`, so values
 * containing `=` survive. Duplicate keys in a malformed source file: only the
 * first occurrence is rewritten (`parseEnvFile` reads last-wins, so a duplicate
 * still shadows the update — a pre-existing pathology, not handled here).
 */
function upsertEnvLines(content: string, vars: Record<string, string>): string {
  const hadTrailingNewline = content.endsWith('\n');
  const body = hadTrailingNewline ? content.slice(0, -1) : content;
  const pending = new Map(Object.entries(vars));

  // An empty body has no lines at all — splitting it would invent a blank one.
  const lines =
    body === ''
      ? []
      : body.split(/\r?\n/).map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const eq = trimmed.indexOf('=');
          if (eq === -1) return line;
          const key = trimmed.slice(0, eq);
          if (!pending.has(key)) return line;
          const value = pending.get(key)!;
          pending.delete(key);
          return `${key}=${value}`;
        });

  for (const [key, value] of pending) {
    lines.push(`${key}=${value}`);
  }

  // Always exactly one trailing newline, matching the previous writer.
  return lines.join('\n') + '\n';
}

/**
 * Copy `envPath` to `{envPath}.bak` before the first CLI mutation.
 *
 * Stateless: existence of the backup IS the "already backed up" flag, so a
 * second write in the same run — or a later run — never overwrites the original
 * pre-CLI file. Deliberately not a module-level flag: this module is otherwise
 * pure, and the writers have four call sites across the codebase.
 *
 * `ensureGitignore` runs BEFORE the write so a crash between the two cannot
 * leave an unignored secret on disk: `stageAndCommit` runs `git add -A`, and the
 * env file holds a live API key and claim token.
 */
function backupEnvFile(installDir: string, envPath: string): void {
  if (!existsSync(envPath)) return; // nothing to back up
  const backupPath = `${envPath}.bak`;
  if (existsSync(backupPath)) return; // never overwrite an earlier backup

  const backupName = basename(backupPath);
  ensureGitignore(installDir, backupName, [backupName, '.env*', '*.bak']);
  writeFileSync(backupPath, readFileSync(envPath, 'utf-8'));
}

/** Drop keys whose value is undefined so they never serialize as `KEY=undefined`. */
function definedVars(envVars: Partial<EnvVars>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * Write environment variables to .env.local before agent runs.
 * Upserts into an existing .env.local if present (new vars take precedence),
 * preserving comments, blank lines, and key order.
 * Auto-generates WORKOS_COOKIE_PASSWORD if not already set.
 */
export function writeEnvLocal(installDir: string, envVars: Partial<EnvVars>): void {
  const envPath = join(installDir, '.env.local');

  backupEnvFile(installDir, envPath);

  const existingContent = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
  const existingEnv = parseEnvFile(existingContent);

  const vars = definedVars(envVars);

  // Generate cookie password only when neither the caller nor the file has one
  if (!vars.WORKOS_COOKIE_PASSWORD && !existingEnv.WORKOS_COOKIE_PASSWORD) {
    vars.WORKOS_COOKIE_PASSWORD = generateCookiePassword();
  }

  ensureGitignore(installDir, '.env.local', ENV_LOCAL_COVERING_PATTERNS);

  writeFileSync(envPath, upsertEnvLines(existingContent, vars));
}

/**
 * Write WorkOS credentials to the appropriate env file for the project.
 * Picks `.env.local` for JS projects (package.json present) or `.env` for
 * everything else (Python/Django, Ruby/Rails, Go, ...). Skips cookie password
 * generation outside the JS branch — non-JS SDKs don't use it.
 *
 * Used by pre-detection flows that write credentials before the framework
 * integration is known (unclaimed env provisioning).
 *
 * KEEP IN SYNC: `resolveProjectEnvPath` in ./project-env.ts mirrors the
 * package.json test below so the no-clobber check reads the same file this
 * writes. If they disagree, the installer can check one file and overwrite
 * another — the original bug.
 */
export function writeCredentialsEnv(installDir: string, envVars: Partial<EnvVars>): void {
  const hasPackageJson = existsSync(join(installDir, 'package.json'));
  if (hasPackageJson) {
    writeEnvLocal(installDir, envVars);
    return;
  }

  const envPath = join(installDir, '.env');

  backupEnvFile(installDir, envPath);

  const existingContent = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';

  ensureGitignore(installDir, '.env', ENV_COVERING_PATTERNS);

  writeFileSync(envPath, upsertEnvLines(existingContent, definedVars(envVars)));
}
