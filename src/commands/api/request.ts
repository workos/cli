import { resolveApiKeyAsync, resolveApiBaseUrl } from '../../lib/api-key.js';
import { wifAuthHeaders } from '../../lib/wif.js';

export interface ApiRequestOptions {
  method: string;
  path: string;
  apiKey?: string;
  body?: string;
  baseUrl?: string;
}

export interface ApiResponse {
  status: number;
  headers: Headers;
  body: unknown;
  rawBody: string;
}

export async function apiRequest(options: ApiRequestOptions): Promise<ApiResponse> {
  const apiKey = options.apiKey ?? (await resolveApiKeyAsync());
  const baseUrl = options.baseUrl ?? resolveApiBaseUrl();

  let path = options.path;
  if (!path.startsWith('/')) path = `/${path}`;

  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    // An API key passes through as `Bearer <key>`; a WIF token is refreshed
    // if needed and carries x-url-environment-id when configured.
    ...(await wifAuthHeaders(apiKey)),
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to connect to WorkOS API: ${detail}`, err instanceof Error ? { cause: err } : undefined);
  }

  const rawBody = await response.text();

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = rawBody;
  }

  return { status: response.status, headers: response.headers, body, rawBody };
}
