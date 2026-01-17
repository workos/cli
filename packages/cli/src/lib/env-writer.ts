import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface EnvVars {
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID: string;
  WORKOS_REDIRECT_URI: string;
  WORKOS_COOKIE_PASSWORD?: string;
}

/**
 * Generate a cryptographically secure cookie password.
 * Returns 32-char hex string (16 random bytes).
 * Uses Web Crypto API available in Node.js 20+
 */
function generateCookiePassword(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

/**
 * Parse a .env file into key-value pairs.
 * Handles comments, empty lines, and values containing '='.
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key) {
        result[key] = valueParts.join('=');
      }
    }
  }
  return result;
}

/**
 * Write environment variables to .env.local before agent runs.
 * Merges with existing .env.local if present (new vars take precedence).
 * Auto-generates WORKOS_COOKIE_PASSWORD if not provided.
 */
export function writeEnvLocal(
  installDir: string,
  envVars: Partial<EnvVars>,
): void {
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

  writeFileSync(envPath, content + '\n');
}
