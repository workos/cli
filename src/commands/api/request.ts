import { resolveApiKey, resolveApiBaseUrl } from '../../lib/api-key.js';

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
  const apiKey = options.apiKey ?? resolveApiKey();
  const baseUrl = options.baseUrl ?? resolveApiBaseUrl();

  let path = options.path;
  if (!path.startsWith('/')) path = `/${path}`;

  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
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
