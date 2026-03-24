import type { Context, ErrorHandler, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class WorkOSApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    public errors?: Array<{ field: string; code: string; message?: string }>,
  ) {
    super(message);
    this.name = 'WorkOSApiError';
  }
}

export function createApiErrorHandler(): ErrorHandler {
  return (err, c) => {
    if (err instanceof WorkOSApiError) {
      const body: Record<string, unknown> = {
        message: err.message,
        code: err.code,
      };
      if (err.errors) {
        body.errors = err.errors;
      }
      return c.json(body, err.status as ContentfulStatusCode);
    }

    const status = errorStatus(err);
    return c.json(
      {
        message: 'Internal Server Error',
        code: 'server_error',
      },
      status as ContentfulStatusCode,
    );
  };
}

export function requestIdMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.req.header('X-Request-ID') ?? `req_${crypto.randomUUID()}`;
    c.set('requestId', requestId);
    c.header('X-Request-ID', requestId);
    await next();
  };
}

export function notFound(resource?: string): WorkOSApiError {
  return new WorkOSApiError(404, resource ? `${resource} not found` : 'Not Found', 'not_found');
}

export function validationError(message: string, errors?: WorkOSApiError['errors']): WorkOSApiError {
  return new WorkOSApiError(422, message, 'unprocessable_entity', errors);
}

export function unauthorized(): WorkOSApiError {
  return new WorkOSApiError(401, 'Unauthorized', 'unauthorized');
}

export function forbidden(): WorkOSApiError {
  return new WorkOSApiError(403, 'Forbidden', 'forbidden');
}

export async function parseJsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return {};
  } catch {
    throw new WorkOSApiError(400, 'Problems parsing JSON', 'invalid_request_body');
  }
}

function errorStatus(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === 'number' && Number.isFinite(s)) return s;
  }
  return 500;
}
