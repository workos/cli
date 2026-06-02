import { describe, it, expect } from 'vitest';
import { CliExit } from './cli-exit.js';

describe('CliExit', () => {
  it('carries exit code and is an Error', () => {
    const exit = new CliExit(1);
    expect(exit).toBeInstanceOf(Error);
    expect(exit.exitCode).toBe(1);
    expect(exit.name).toBe('CliExit');
  });

  it('carries optional telemetry context', () => {
    const exit = new CliExit(4, {
      reason: 'auth_required',
      errorCode: 'auth_required',
    });
    expect(exit.exitCode).toBe(4);
    expect(exit.context?.reason).toBe('auth_required');
    expect(exit.context?.errorCode).toBe('auth_required');
  });

  it('carries optional apiContext', () => {
    const exit = new CliExit(1, {
      reason: 'api_error',
      errorCode: 'http_500',
      apiContext: { status: 500, code: 'internal_server_error', resource: 'organizations' },
    });
    expect(exit.context?.apiContext?.status).toBe(500);
  });

  it('defaults context to undefined', () => {
    const exit = new CliExit(0);
    expect(exit.context).toBeUndefined();
  });
});
