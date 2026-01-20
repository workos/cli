import { z } from 'zod';
import { analytics } from '../utils/analytics.js';

export const ApiUserSchema = z.object({
  distinct_id: z.string(),
  organizations: z.array(
    z.object({
      id: z.uuid(),
    }),
  ),
  team: z.object({
    id: z.number(),
    organization: z.uuid(),
  }),
  organization: z.object({
    id: z.uuid(),
  }),
});

export const ApiProjectSchema = z.object({
  id: z.number(),
  uuid: z.uuid(),
  organization: z.uuid(),
  api_token: z.string(),
  name: z.string(),
});

export type ApiUser = z.infer<typeof ApiUserSchema>;
export type ApiProject = z.infer<typeof ApiProjectSchema>;

class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchUserData(accessToken: string, baseUrl: string): Promise<ApiUser> {
  const endpoint = '/api/users/@me/';
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw await createFetchError(response, endpoint);
    }

    const data = await response.json();
    return ApiUserSchema.parse(data);
  } catch (error) {
    const apiError = handleApiError(error, 'fetch user data', endpoint);
    analytics.captureException(apiError, {
      endpoint,
      baseUrl,
    });
    throw apiError;
  }
}

export async function fetchProjectData(accessToken: string, projectId: number, baseUrl: string): Promise<ApiProject> {
  const endpoint = `/api/projects/${projectId}/`;
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw await createFetchError(response, endpoint);
    }

    const data = await response.json();
    return ApiProjectSchema.parse(data);
  } catch (error) {
    const apiError = handleApiError(error, 'fetch project data', endpoint);
    analytics.captureException(apiError, {
      endpoint,
      baseUrl,
      projectId,
    });
    throw apiError;
  }
}

interface FetchError extends Error {
  status: number;
  endpoint: string;
  detail?: string;
}

async function createFetchError(response: Response, endpoint: string): Promise<FetchError> {
  let detail: string | undefined;
  try {
    const data: unknown = await response.json();
    if (typeof data === 'object' && data !== null && 'detail' in data) {
      detail = String((data as { detail: unknown }).detail);
    }
  } catch {
    // Response wasn't JSON
  }

  const error = new Error(`HTTP ${response.status}`) as FetchError;
  error.status = response.status;
  error.endpoint = endpoint;
  error.detail = detail;
  return error;
}

function isFetchError(error: unknown): error is FetchError {
  return error instanceof Error && 'status' in error && typeof (error as FetchError).status === 'number';
}

function handleApiError(error: unknown, operation: string, endpoint: string): ApiError {
  if (isFetchError(error)) {
    const { status, detail } = error;

    if (status === 401) {
      return new ApiError(`Authentication failed while trying to ${operation}`, status, endpoint);
    }

    if (status === 403) {
      return new ApiError(`Access denied while trying to ${operation}`, status, endpoint);
    }

    if (status === 404) {
      return new ApiError(`Resource not found while trying to ${operation}`, status, endpoint);
    }

    const message = detail || `Failed to ${operation}`;
    return new ApiError(message, status, endpoint);
  }

  if (error instanceof z.ZodError) {
    return new ApiError(`Invalid response format while trying to ${operation}`);
  }

  return new ApiError(
    `Unexpected error while trying to ${operation}: ${error instanceof Error ? error.message : 'Unknown error'}`,
  );
}
