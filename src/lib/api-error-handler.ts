import { WorkOSApiError } from './workos-api.js';
import { exitWithError } from '../utils/output.js';

export function isSdkException(
  error: unknown,
): error is { status: number; message: string; requestID: string; code?: string; errors?: Array<{ message: string }> } {
  if (!(error instanceof Error)) return false;
  const e = error as Error & { status?: unknown; requestID?: unknown };
  return typeof e.status === 'number' && typeof e.requestID === 'string';
}

interface NormalizedApiError {
  status: number;
  code?: string;
  errors?: Array<{ message: string }>;
  message: string;
}

function normalizeApiError(error: unknown): NormalizedApiError | null {
  if (error instanceof WorkOSApiError) {
    return {
      status: error.statusCode,
      code: error.code,
      errors: error.errors,
      message: error.message,
    };
  }

  if (isSdkException(error)) {
    return {
      status: error.status,
      code: error.code,
      errors: error.errors,
      message: error.message,
    };
  }

  return null;
}

function getApiErrorMessage(error: NormalizedApiError, label: string): string {
  if (error.status === 401) return 'Invalid API key. Check your environment configuration.';
  if (error.status === 404) return `${label} not found.`;
  if (error.status === 422 && error.errors?.length) return error.errors.map((e) => e.message).join(', ');
  return error.message;
}

/**
 * Create a resource-specific API error handler.
 * Handles raw fetch errors (WorkOSApiError), SDK exceptions, and the SDK's
 * "errors is not iterable" TypeError from malformed 422 responses.
 *
 * `context` optionally names the specific resource instance (e.g. a vault
 * object name) so 404 messages can be more specific.
 */
export function createApiErrorHandler(resourceName: string) {
  return (error: unknown, context?: string): never => {
    if (error instanceof TypeError && error.message.includes('errors is not iterable')) {
      exitWithError({
        code: 'unprocessable_entity',
        message: `${resourceName} API rejected the request. Check that all required fields are provided.`,
        apiContext: { resource: resourceName },
      });
    }

    const label = context ? `${resourceName} '${context}'` : resourceName;
    const apiError = normalizeApiError(error);
    if (apiError) {
      const code = apiError.code ?? `http_${apiError.status}`;
      exitWithError({
        code,
        message: getApiErrorMessage(apiError, label),
        details: apiError.errors,
        apiContext: {
          status: apiError.status,
          code,
          resource: resourceName,
        },
      });
    }

    exitWithError({
      code: 'unknown_error',
      message: error instanceof Error ? error.message : 'Unknown error',
      apiContext: { resource: resourceName },
    });
  };
}
