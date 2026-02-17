/**
 * Generic WorkOS API client.
 * Thin fetch wrapper with auth, error parsing, and query param support.
 */

const DEFAULT_BASE_URL = 'https://api.workos.com';

export interface WorkOSRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  apiKey: string;
  baseUrl?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | undefined>;
}

export interface WorkOSListResponse<T> {
  data: T[];
  list_metadata: {
    before: string | null;
    after: string | null;
  };
}

export class WorkOSApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly errors?: Array<{ message: string }>,
  ) {
    super(message);
    this.name = 'WorkOSApiError';
  }
}

export async function workosRequest<T>(options: WorkOSRequestOptions): Promise<T> {
  const { method, path, apiKey, baseUrl = DEFAULT_BASE_URL, body, params } = options;

  let url = `${baseUrl}${path}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  const fetchOptions: RequestInit = { method, headers };

  if (body && (method === 'POST' || method === 'PUT')) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch {
    throw new WorkOSApiError('Failed to connect to WorkOS API. Check your internet connection.', 0);
  }

  if (response.status === 204 || response.status === 202) {
    return null as T;
  }

  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Non-JSON response — if ok, return null; otherwise throw
    if (response.ok) return null as T;
    throw new WorkOSApiError(text || `HTTP ${response.status}`, response.status);
  }

  if (!response.ok) {
    const message = (data as { message?: string }).message || `HTTP ${response.status}`;
    const code = (data as { code?: string }).code;
    const errors = (data as { errors?: Array<{ message: string }> }).errors;
    throw new WorkOSApiError(message, response.status, code, errors);
  }

  return data as T;
}
