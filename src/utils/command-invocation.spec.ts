import { describe, expect, it } from 'vitest';
import { formatWorkOSCommand, formatWorkOSCommandArgs, getWorkOSCommand, shellQuoteArg } from './command-invocation.js';

describe('command invocation helpers', () => {
  it('uses workos for regular global/local invocations', () => {
    expect(getWorkOSCommand({})).toBe('workos');
  });

  it('uses npx workos@latest when launched by npm exec', () => {
    expect(getWorkOSCommand({ npm_command: 'exec' })).toBe('npx workos@latest');
  });

  it('formats commands with the detected invocation', () => {
    expect(formatWorkOSCommand('auth login', { npm_command: 'exec' })).toBe('npx workos@latest auth login');
  });

  it('quotes shell arguments that contain JSON or shell metacharacters', () => {
    expect(shellQuoteArg('{"name":"Acme"}')).toBe('\'{"name":"Acme"}\'');
    expect(shellQuoteArg("O'Hara")).toBe("'O'\\''Hara'");
  });

  it('formats commands from argv-like parts', () => {
    expect(formatWorkOSCommandArgs(['api', '/organizations', '--data', '{"name":"Acme"}'], {})).toBe(
      'workos api /organizations --data \'{"name":"Acme"}\'',
    );
  });
});
