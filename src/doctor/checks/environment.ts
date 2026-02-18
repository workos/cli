import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EnvironmentInfo, EnvironmentCheckResult, DoctorOptions } from '../types.js';

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Strip optional `export ` prefix
    const entry = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
    const eqIndex = entry.indexOf('=');
    if (eqIndex === -1) continue;

    const key = entry.slice(0, eqIndex).trim();
    let value = entry.slice(eqIndex + 1).trim();

    // Remove surrounding quotes (single or double)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Load environment variables from project's .env files.
 * Priority: .env.local > .env (matching Next.js/Vite conventions)
 */
function loadProjectEnv(installDir: string): Record<string, string> {
  const env: Record<string, string> = {};

  // Load in order: .env first, then .env.local (later overrides earlier)
  const envFiles = ['.env', '.env.local'];

  for (const file of envFiles) {
    const filePath = join(installDir, file);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        Object.assign(env, parseEnvFile(content));
      } catch {
        // Ignore read errors
      }
    }
  }

  return env;
}

export function checkEnvironment(options?: DoctorOptions): EnvironmentCheckResult {
  // Load project env files, then fall back to process.env
  const projectEnv = options?.installDir ? loadProjectEnv(options.installDir) : {};

  const apiKey = projectEnv.WORKOS_API_KEY ?? process.env.WORKOS_API_KEY ?? null;
  const clientId = projectEnv.WORKOS_CLIENT_ID ?? process.env.WORKOS_CLIENT_ID ?? null;
  const redirectUri = projectEnv.WORKOS_REDIRECT_URI ?? process.env.WORKOS_REDIRECT_URI ?? null;
  const cookieDomain = projectEnv.WORKOS_COOKIE_DOMAIN ?? process.env.WORKOS_COOKIE_DOMAIN ?? null;
  const baseUrl = projectEnv.WORKOS_BASE_URL ?? process.env.WORKOS_BASE_URL ?? null;

  return {
    info: {
      apiKeyConfigured: !!apiKey,
      apiKeyType: getApiKeyType(apiKey),
      clientId: truncateClientId(clientId),
      redirectUri: redirectUri,
      cookieDomain: cookieDomain,
      baseUrl: baseUrl ?? 'https://api.workos.com',
    },
    raw: {
      apiKey,
      clientId,
      baseUrl: baseUrl ?? 'https://api.workos.com',
    },
  };
}

function getApiKeyType(apiKey: string | undefined): 'staging' | 'production' | null {
  if (!apiKey) return null;
  if (apiKey.startsWith('sk_test_')) return 'staging';
  if (apiKey.startsWith('sk_live_')) return 'production';
  return null; // Unknown format
}

function truncateClientId(clientId: string | undefined): string | null {
  if (!clientId) return null;
  if (clientId.length <= 15) return clientId;
  return `${clientId.slice(0, 10)}...${clientId.slice(-3)}`;
}
