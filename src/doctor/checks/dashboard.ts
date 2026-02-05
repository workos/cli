import type { DashboardSettings, DashboardFetchResult, DoctorOptions, RedirectUriComparison, EnvironmentRaw } from '../types.js';

const WORKOS_API_URL = 'https://api.workos.com';

export interface CredentialValidation {
  valid: boolean;
  clientIdMatch: boolean;
  error?: string;
}

export async function checkDashboardSettings(
  options: DoctorOptions,
  apiKeyType: 'staging' | 'production' | null,
  raw: EnvironmentRaw,
): Promise<DashboardFetchResult> {
  // Never call API with production keys
  if (apiKeyType === 'production') {
    return { settings: null, error: 'Skipped (production API key)' };
  }

  if (options.skipApi) {
    return { settings: null, error: 'Skipped (--skip-api)' };
  }

  const apiKey = raw.apiKey;
  if (!apiKey) {
    return { settings: null, error: 'No API key configured' };
  }

  try {
    const settings = await fetchDashboardSettings(apiKey, raw.baseUrl);
    return { settings };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { settings: null, error: message };
  }
}

/**
 * Validate credentials against WorkOS API.
 * Checks if API key is valid by making a simple API call.
 */
export async function validateCredentials(
  apiKeyType: 'staging' | 'production' | null,
  raw: EnvironmentRaw,
  skipApi?: boolean,
): Promise<CredentialValidation | null> {
  // Skip for production keys or if API calls disabled
  if (apiKeyType === 'production' || skipApi || !raw.apiKey) {
    return null;
  }

  const baseUrl = raw.baseUrl ?? WORKOS_API_URL;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    // Use /organizations endpoint to validate API key (lightweight call)
    const response = await fetch(`${baseUrl}/organizations?limit=1`, {
      headers: { Authorization: `Bearer ${raw.apiKey}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { valid: false, clientIdMatch: true, error: 'Invalid API key' };
      }
      if (response.status === 403) {
        return { valid: false, clientIdMatch: true, error: 'API key lacks permissions' };
      }
      return { valid: false, clientIdMatch: true, error: `API error: ${response.status}` };
    }

    // API key is valid - we can't easily verify client ID match without a dedicated endpoint
    // but at least we know the key works
    return {
      valid: true,
      clientIdMatch: true, // Assume match since we can't verify
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { valid: false, clientIdMatch: true, error: 'Validation timeout' };
    }
    return null; // Network error, skip validation
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchDashboardSettings(apiKey: string, baseUrlOverride: string | null): Promise<DashboardSettings> {
  const baseUrl = baseUrlOverride ?? WORKOS_API_URL;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    // Note: WorkOS API doesn't expose a public endpoint to list redirect URIs
    // The management API only supports creating them (POST), not listing (GET)
    // We skip redirect URI fetching - the installer creates them but can't verify them
    const redirectUris: string[] = [];

    // Validate API key by making a lightweight call
    const orgsCheckResponse = await fetch(`${baseUrl}/organizations?limit=1`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    // Check for auth errors
    if (orgsCheckResponse.status === 401) {
      throw new Error('Invalid API key (401)');
    }
    if (orgsCheckResponse.status === 403) {
      throw new Error('API key lacks permissions (403)');
    }

    // Fetch environment settings
    const envResponse = await fetch(`${baseUrl}/environments/current`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    let authMethods: string[] = [];
    let sessionTimeout: string | null = null;
    let mfa: 'optional' | 'required' | 'disabled' | null = null;

    if (envResponse.ok) {
      const envData = (await envResponse.json()) as {
        auth_methods?: string[];
        session_timeout?: string;
        mfa_policy?: 'optional' | 'required' | 'disabled';
      };
      authMethods = envData.auth_methods ?? [];
      sessionTimeout = envData.session_timeout ?? null;
      mfa = envData.mfa_policy ?? null;
    }

    // Fetch organization count
    const orgsResponse = await fetch(`${baseUrl}/organizations?limit=1`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    let organizationCount = 0;
    if (orgsResponse.ok) {
      const orgsData = (await orgsResponse.json()) as {
        list_metadata?: { total_count?: number };
        data?: unknown[];
      };
      organizationCount = orgsData.list_metadata?.total_count ?? orgsData.data?.length ?? 0;
    }

    return {
      redirectUris,
      authMethods,
      sessionTimeout,
      mfa,
      organizationCount,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timeout (10s)');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Normalize a URI for comparison:
 * - Remove trailing slashes
 * - Normalize localhost variants (127.0.0.1 → localhost)
 * - Lowercase the host portion
 */
function normalizeUri(uri: string): string {
  try {
    const url = new URL(uri);
    // Normalize localhost variants
    if (url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
      url.hostname = 'localhost';
    }
    // Lowercase hostname (but preserve path case for compatibility)
    url.hostname = url.hostname.toLowerCase();
    // Remove trailing slash from pathname (unless it's just "/")
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    // If URL parsing fails, return as-is for exact match fallback
    return uri;
  }
}

export function compareRedirectUris(
  codeUri: string | null,
  dashboardUris: string[],
  source?: 'env' | 'inferred',
): RedirectUriComparison {
  if (!codeUri) {
    return { codeUri, dashboardUris, match: false, source };
  }

  const normalizedCode = normalizeUri(codeUri);
  const normalizedDashboard = dashboardUris.map(normalizeUri);
  const match = normalizedDashboard.includes(normalizedCode);

  return { codeUri, dashboardUris, match, source };
}
