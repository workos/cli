/**
 * Staging Credentials API Client
 * Fetches WorkOS staging environment credentials using an authenticated access token.
 */

import { getWorkOSApiUrl } from '../utils/urls.js';
import { debug, logToFile } from '../utils/debug.js';

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

function getStagingApiUrl(): string {
  const url = `${getWorkOSApiUrl()}/x/installer/staging-environment/credentials`;
  logToFile('Staging API URL:', url);
  debug('Staging API URL:', url);
  return url;
}

export async function fetchStagingCredentials(accessToken: string): Promise<StagingCredentials> {
  let res: Response;
  const url = getStagingApiUrl();

  logToFile('Token (first 50 chars):', accessToken.substring(0, 50) + '...');
  debug('Token (first 50 chars):', accessToken.substring(0, 50) + '...');
  debug('Calling:', url);

  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    logToFile('Network error:', e);
    debug('Network error:', e);
    throw new StagingApiError('Network error. Check your connection.');
  }

  logToFile('Response status:', res.status);
  debug('Response status:', res.status);

  if (!res.ok) {
    const text = await res.text();
    logToFile('Response body:', text);
    debug('Response body:', text);

    if (res.status === 401) {
      throw new StagingApiError(`Authentication failed (401): ${text}`, 401);
    }
    if (res.status === 403) {
      throw new StagingApiError(`Access denied (403): ${text}`, 403);
    }

    throw new StagingApiError(`Failed to fetch credentials: ${res.status} ${text}`, res.status);
  }

  const data = (await res.json()) as Record<string, unknown>;
  logToFile('Staging API response:', JSON.stringify(data, null, 2));
  debug('Staging API response:', JSON.stringify(data, null, 2));

  // Handle both snake_case and camelCase responses
  const clientId = (data.client_id ?? data.clientId) as string | undefined;
  const apiKey = (data.api_key ?? data.apiKey) as string | undefined;

  if (!clientId) {
    throw new StagingApiError('Staging API response missing client_id');
  }

  return { clientId, apiKey: apiKey ?? '' };
}
