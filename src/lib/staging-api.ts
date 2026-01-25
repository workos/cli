/**
 * Staging Environment Credentials API Client
 *
 * Fetches WorkOS staging credentials (client_id, api_key) from the staging API.
 * Requires an access token with 'staging-environment:credentials:read' scope.
 */

export interface StagingCredentials {
  clientId: string;
  apiKey: string;
}

export class StagingApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'StagingApiError';
  }
}

const STAGING_API_URL = 'https://api.workos.com/x/installer/staging-environment/credentials';
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Fetch staging environment credentials from the WorkOS API.
 *
 * @param accessToken - Bearer token with staging-environment:credentials:read scope
 * @returns StagingCredentials containing clientId and apiKey
 * @throws StagingApiError on auth failure, permission denied, or other HTTP errors
 */
export async function fetchStagingCredentials(accessToken: string): Promise<StagingCredentials> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(STAGING_API_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');

      if (res.status === 401) {
        throw new StagingApiError('Authentication expired. Please log in again.', 401);
      }
      if (res.status === 403) {
        throw new StagingApiError('Access denied. Ensure you have the required permissions.', 403);
      }
      if (res.status === 404) {
        throw new StagingApiError('No staging environment found. Create one in the WorkOS dashboard.', 404);
      }

      throw new StagingApiError(`Failed to fetch credentials: ${res.status} ${text}`, res.status);
    }

    const data = (await res.json()) as { clientId?: string; apiKey?: string; client_id?: string; api_key?: string };

    // Handle both camelCase and snake_case responses
    const clientId = data.clientId || data.client_id;
    const apiKey = data.apiKey || data.api_key;

    if (!clientId || !apiKey) {
      throw new StagingApiError('Invalid response: missing clientId or apiKey');
    }

    return { clientId, apiKey };
  } catch (error) {
    if (error instanceof StagingApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new StagingApiError('Request timed out. Check your network connection.');
    }
    throw new StagingApiError(
      `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
