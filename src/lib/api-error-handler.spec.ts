import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { WorkOSApiError } = await import('./workos-api.js');
const { createApiErrorHandler } = await import('./api-error-handler.js');
const { setOutputMode } = await import('../utils/output.js');
const { CliExit } = await import('../utils/cli-exit.js');

describe('createApiErrorHandler', () => {
  let stderrOutput: string[];

  beforeEach(() => {
    setOutputMode('json');
    stderrOutput = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderrOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    setOutputMode('human');
    vi.restoreAllMocks();
  });

  function parseError(): { error: { code: string; message: string; details?: unknown } } {
    return JSON.parse(stderrOutput[0]);
  }

  /**
   * Invoke the handler and capture the CliExit it throws.
   *
   * `exitWithError` throws `CliExit`, so handlers are typed `(error) => never`.
   * We catch the throw here so individual tests can assert on stderr output
   * and on the CliExit context (reason / errorCode / apiContext) separately.
   */
  function invoke(handler: (error: unknown) => never, error: unknown): CliExit {
    try {
      handler(error);
    } catch (e) {
      if (e instanceof CliExit) return e;
      throw e;
    }
    throw new Error('handler did not throw CliExit');
  }

  function makeSdkError(
    status: number,
    message: string,
    extras?: { code?: string; requestID?: string; errors?: Array<{ message: string }> },
  ) {
    const err = new Error(message) as Error & {
      status: number;
      requestID: string;
      code?: string;
      errors?: Array<{ message: string }>;
    };
    err.status = status;
    err.requestID = extras?.requestID ?? 'req_test';
    if (extras?.code) err.code = extras.code;
    if (extras?.errors) err.errors = extras.errors;
    return err;
  }

  describe('WorkOSApiError (raw fetch)', () => {
    it('handles 401 with friendly message', () => {
      const handler = createApiErrorHandler('Organization');
      const exit = invoke(handler, new WorkOSApiError('Unauthorized', 401));
      expect(parseError().error.message).toBe('Invalid API key. Check your environment configuration.');
      expect(parseError().error.code).toBe('http_401');
      expect(exit.exitCode).toBe(1);
    });

    it('handles 404 with resource name', () => {
      const handler = createApiErrorHandler('Organization');
      invoke(handler, new WorkOSApiError('Not Found', 404));
      expect(parseError().error.message).toBe('Organization not found.');
    });

    it('handles 422 with validation errors', () => {
      const handler = createApiErrorHandler('Organization');
      invoke(
        handler,
        new WorkOSApiError('Validation failed', 422, undefined, [
          { message: 'Name is required' },
          { message: 'Domain invalid' },
        ]),
      );
      expect(parseError().error.message).toBe('Name is required, Domain invalid');
    });

    it('uses error.code when available', () => {
      const handler = createApiErrorHandler('User');
      invoke(handler, new WorkOSApiError('Bad request', 400, 'invalid_request'));
      expect(parseError().error.code).toBe('invalid_request');
    });

    it('falls back to http_{status} code', () => {
      const handler = createApiErrorHandler('User');
      invoke(handler, new WorkOSApiError('Server error', 500));
      expect(parseError().error.code).toBe('http_500');
    });
  });

  describe('SDK exceptions (@workos-inc/node)', () => {
    it('handles 401 (UnauthorizedException)', () => {
      const handler = createApiErrorHandler('Organization');
      invoke(handler, makeSdkError(401, 'Could not authorize the request'));
      expect(parseError().error.message).toBe('Invalid API key. Check your environment configuration.');
      expect(parseError().error.code).toBe('http_401');
    });

    it('handles 404 (NotFoundException)', () => {
      const handler = createApiErrorHandler('Role');
      invoke(handler, makeSdkError(404, 'Resource not found'));
      expect(parseError().error.message).toBe('Role not found.');
    });

    it('handles 422 with errors array', () => {
      const handler = createApiErrorHandler('Permission');
      invoke(handler, makeSdkError(422, 'Validation failed', { errors: [{ message: 'Slug already taken' }] }));
      expect(parseError().error.message).toBe('Slug already taken');
    });

    it('handles 400 (BadRequestException) with raw message', () => {
      const handler = createApiErrorHandler('Event');
      invoke(handler, makeSdkError(400, 'events parameter is required'));
      expect(parseError().error.message).toBe('events parameter is required');
    });

    it('handles 429 (RateLimitExceededException)', () => {
      const handler = createApiErrorHandler('User');
      invoke(handler, makeSdkError(429, 'Rate limit exceeded'));
      expect(parseError().error.message).toBe('Rate limit exceeded');
      expect(parseError().error.code).toBe('http_429');
    });

    it('handles 500 (GenericServerException)', () => {
      const handler = createApiErrorHandler('Webhook');
      invoke(handler, makeSdkError(500, 'Internal server error'));
      expect(parseError().error.message).toBe('Internal server error');
    });

    it('uses code when available', () => {
      const handler = createApiErrorHandler('User');
      invoke(handler, makeSdkError(422, 'Invalid', { code: 'validation_error' }));
      expect(parseError().error.code).toBe('validation_error');
    });
  });

  describe('fallback (generic errors)', () => {
    it('handles generic Error', () => {
      const handler = createApiErrorHandler('Thing');
      invoke(handler, new Error('Network timeout'));
      expect(parseError().error.code).toBe('unknown_error');
      expect(parseError().error.message).toBe('Network timeout');
    });

    it('handles non-Error values', () => {
      const handler = createApiErrorHandler('Thing');
      invoke(handler, 'some string');
      expect(parseError().error.code).toBe('unknown_error');
      expect(parseError().error.message).toBe('Unknown error');
    });

    it('handles null', () => {
      const handler = createApiErrorHandler('Thing');
      invoke(handler, null);
      expect(parseError().error.code).toBe('unknown_error');
    });
  });

  describe('telemetry apiContext', () => {
    // `exitWithError` throws `CliExit` carrying the apiContext, which the
    // top-level CLI catch in `bin.ts` forwards to `emitCommandEvent`. We
    // assert directly on the thrown CliExit's context here.

    it('WorkOSApiError path populates apiContext with status/code/resource', () => {
      const handler = createApiErrorHandler('Organization');
      const exit = invoke(handler, new WorkOSApiError('Unauthorized', 401));

      expect(exit.context?.reason).toBe('api_error');
      expect(exit.context?.errorCode).toBe('http_401');
      expect(exit.context?.apiContext).toEqual({ status: 401, code: 'http_401', resource: 'Organization' });
    });

    it('WorkOSApiError uses error.code in apiContext when present', () => {
      const handler = createApiErrorHandler('User');
      const exit = invoke(handler, new WorkOSApiError('Validation failed', 422, 'validation_error'));

      expect(exit.context?.reason).toBe('api_error');
      expect(exit.context?.errorCode).toBe('validation_error');
      expect(exit.context?.apiContext).toEqual({ status: 422, code: 'validation_error', resource: 'User' });
    });

    it('SDK exception path populates apiContext with status/code/resource', () => {
      const handler = createApiErrorHandler('Organization');
      const exit = invoke(handler, makeSdkError(429, 'Rate limit exceeded', { code: 'rate_limited' }));

      expect(exit.context?.reason).toBe('api_error');
      expect(exit.context?.errorCode).toBe('rate_limited');
      expect(exit.context?.apiContext).toEqual({ status: 429, code: 'rate_limited', resource: 'Organization' });
    });

    it('SDK exception falls back to http_{status} when code absent', () => {
      const handler = createApiErrorHandler('Role');
      const exit = invoke(handler, makeSdkError(404, 'Not found'));

      expect(exit.context?.reason).toBe('api_error');
      expect(exit.context?.errorCode).toBe('http_404');
      expect(exit.context?.apiContext).toEqual({ status: 404, code: 'http_404', resource: 'Role' });
    });

    it('fallback (generic Error) populates resource only — no status/code', () => {
      const handler = createApiErrorHandler('Thing');
      const exit = invoke(handler, new Error('Network timeout'));

      expect(exit.context?.reason).toBe('api_error');
      expect(exit.context?.errorCode).toBe('unknown_error');
      expect(exit.context?.apiContext).toEqual({ resource: 'Thing' });
    });
  });
});
