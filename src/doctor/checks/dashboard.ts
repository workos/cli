import type { CredentialValidation, DashboardSettings, DashboardFetchResult, DoctorOptions, RedirectUriComparison, EnvironmentRaw } from '../types.js';

const WORKOS_API_URL = 'https://api.workos.com';

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
    return await fetchDashboardSettings(apiKey, raw.baseUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { settings: null, error: message };
  }
}

async function fetchDashboardSettings(apiKey: string, baseUrlOverride: string | null): Promise<DashboardFetchResult> {
  const baseUrl = baseUrlOverride ?? WORKOS_API_URL;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const redirectUris: string[] = [];

    // Single /organizations?limit=1 call — validates credentials AND gets org count
    const orgsResponse = await fetch(`${baseUrl}/organizations?limit=1`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (orgsResponse.status === 401) {
      return {
        settings: null,
        credentialValidation: { valid: false, clientIdMatch: true, error: 'Invalid API key' },
        error: 'Invalid API key (401)',
      };
    }
    if (orgsResponse.status === 403) {
      return {
        settings: null,
        credentialValidation: { valid: false, clientIdMatch: true, error: 'API key lacks permissions' },
        error: 'API key lacks permissions (403)',
      };
    }
    if (!orgsResponse.ok) {
      return {
        settings: null,
        credentialValidation: { valid: false, clientIdMatch: true, error: `API error: ${orgsResponse.status}` },
        error: `API error: ${orgsResponse.status}`,
      };
    }

    // Credentials valid — extract org count from the same response
    const credentialValidation: CredentialValidation = { valid: true, clientIdMatch: true };

    let organizationCount = 0;
    const orgsData = (await orgsResponse.json()) as {
      list_metadata?: { total_count?: number };
      data?: unknown[];
    };
    organizationCount = orgsData.list_metadata?.total_count ?? orgsData.data?.length ?? 0;

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

    return {
      settings: { redirectUris, authMethods, sessionTimeout, mfa, organizationCount },
      credentialValidation,
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
