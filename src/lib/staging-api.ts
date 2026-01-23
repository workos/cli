/**
 * Staging Credentials API Client
 * Fetches WorkOS staging environment credentials using an authenticated access token.
 */

export interface StagingCredentials {
  clientId: string;
  apiKey: string;
}

export class StagingApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'StagingApiError';
  }
}

const STAGING_API_URL = 'https://api.workos.com/x/installer/staging-environment/credentials';

export async function fetchStagingCredentials(accessToken: string): Promise<StagingCredentials> {
  let res: Response;

  try {
    res = await fetch(STAGING_API_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new StagingApiError('Network error. Check your connection.');
  }

  if (!res.ok) {
    const text = await res.text();

    if (res.status === 401) {
      throw new StagingApiError('Authentication expired. Please log in again.', 401);
    }
    if (res.status === 403) {
      throw new StagingApiError('Access denied. Ensure you have the required permissions.', 403);
    }

    throw new StagingApiError(`Failed to fetch credentials: ${res.status} ${text}`, res.status);
  }

  const data = (await res.json()) as { client_id: string; api_key: string };

  return {
    clientId: data.client_id,
    apiKey: data.api_key,
  };
}
