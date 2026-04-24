import { describe, expect, it } from 'vitest';
import { formatWorkOSCommand, getWorkOSCommand } from './command-invocation.js';

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
});
