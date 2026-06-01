import { WorkOSApiError } from './workos-api.js';
import { exitWithError } from '../utils/output.js';

/**
 * Duck-type check for @workos-inc/node SDK exceptions.
 *
 * The SDK throws typed errors (UnauthorizedException, NotFoundException, etc.)
 * that implement the RequestException interface: { status, message, requestID }.
 * We duck-type rather than instanceof to avoid coupling to the SDK's class hierarchy.
 */
function isSdkException(
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

function getApiErrorMessage(error: NormalizedApiError, resourceName: string): string {
  if (error.status === 401) return 'Invalid API key. Check your environment configuration.';
  if (error.status === 404) return `${resourceName} not found.`;
  if (error.status === 422 && error.errors?.length) return error.errors.map((e) => e.message).join(', ');
  return error.message;
}

/**
 * Create a resource-specific API error handler.
 * Handles both raw fetch errors (WorkOSApiError) and SDK exceptions.
 * Returns a `never` function that writes structured errors and exits.
 */
export function createApiErrorHandler(resourceName: string) {
  return (error: unknown): never => {
    const apiError = normalizeApiError(error);
    if (apiError) {
      const code = apiError.code ?? `http_${apiError.status}`;
      exitWithError({
        code,
        message: getApiErrorMessage(apiError, resourceName),
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
