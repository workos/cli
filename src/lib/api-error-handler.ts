import { WorkOSApiError } from './workos-api.js';
import { exitWithError } from '../utils/output.js';

/**
 * Create a resource-specific API error handler.
 * Returns a `never` function that writes structured errors and exits.
 */
export function createApiErrorHandler(resourceName: string) {
  return (error: unknown): never => {
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
    exitWithError({
      code: 'unknown_error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  };
}
