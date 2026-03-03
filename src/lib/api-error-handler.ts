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

/**
 * Create a resource-specific API error handler.
 * Handles both raw fetch errors (WorkOSApiError) and SDK exceptions.
 * Returns a `never` function that writes structured errors and exits.
 */
export function createApiErrorHandler(resourceName: string) {
  return (error: unknown): never => {
    // 1. Raw fetch errors (workos-api.ts)
    if (error instanceof WorkOSApiError) {
      exitWithError({
        code: error.code ?? `http_${error.statusCode}`,
        message:
          error.statusCode === 401
            ? 'Invalid API key. Check your environment configuration.'
            : error.statusCode === 404
              ? `${resourceName} not found.`
              : error.statusCode === 422 && error.errors?.length
                ? error.errors.map((e) => e.message).join(', ')
                : error.message,
        details: error.errors,
      });
    }

    // 2. SDK exceptions (@workos-inc/node)
    if (isSdkException(error)) {
      exitWithError({
        code: error.code ?? `http_${error.status}`,
        message:
          error.status === 401
            ? 'Invalid API key. Check your environment configuration.'
            : error.status === 404
              ? `${resourceName} not found.`
              : error.status === 422 && error.errors?.length
                ? error.errors.map((e) => e.message).join(', ')
                : error.message,
        details: error.errors,
      });
    }

    // 3. Fallback
    exitWithError({
      code: 'unknown_error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  };
}
