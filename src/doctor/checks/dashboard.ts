import type { DashboardSettings, DoctorOptions, RedirectUriComparison, EnvironmentRaw } from '../types.js';

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
): Promise<DashboardSettings | null> {
  // Never call API with production keys
  if (apiKeyType === 'production') {
    return null;
  }

  if (options.skipApi) {
    return null;
  }

  const apiKey = raw.apiKey;
  if (!apiKey) {
    return null;
  }

  try {
    const settings = await fetchDashboardSettings(apiKey, raw.baseUrl);
    return settings;
  } catch {
    // Fail silently - dashboard data is supplementary
    return null;
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
    // Fetch redirect URIs
    const redirectUrisResponse = await fetch(`${baseUrl}/redirect_uris`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    let redirectUris: string[] = [];
    if (redirectUrisResponse.ok) {
      const data = (await redirectUrisResponse.json()) as { data?: { uri: string }[] };
      redirectUris = data.data?.map((r) => r.uri) ?? [];
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
  } finally {
    clearTimeout(timeoutId);
  }
}

export function compareRedirectUris(codeUri: string | null, dashboardUris: string[]): RedirectUriComparison {
  return {
    codeUri,
    dashboardUris,
    match: codeUri ? dashboardUris.includes(codeUri) : false,
  };
}
