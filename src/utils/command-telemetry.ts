import { COMMAND_ALIASES } from '../lib/command-aliases.js';

export const SKIP_TELEMETRY_COMMANDS = new Set(['install', 'dashboard', 'root']);

export function resolveCanonicalName(parts: string[]): string {
  if (parts.length === 0) return 'root';
  const resolved = [...parts];
  resolved[0] = COMMAND_ALIASES[resolved[0]] ?? resolved[0];
  return resolved.join('.');
}

export function extractUserFlags(rawArgs: string[]): string[] {
  const passedFlags = rawArgs
    .filter((arg) => arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2))
    .map((arg) => arg.replace(/^-+/, '').split('=')[0]);
  return [...new Set(passedFlags)];
}
