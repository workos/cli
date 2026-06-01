import { COMMAND_ALIASES } from '../lib/command-aliases.js';

export const SKIP_TELEMETRY_COMMANDS = new Set(['install', 'dashboard', 'root']);

export function resolveCanonicalName(parts: string[]): string {
  if (parts.length === 0) return 'root';
  const resolved = [...parts];
  resolved[0] = COMMAND_ALIASES[resolved[0]] ?? resolved[0];
  return resolved.join('.');
}

/**
 * Resolve the command name from raw argv for paths where yargs validation
 * fails before middleware runs (e.g. a missing required argument). Only the
 * first non-flag token (the top-level command) is used: later positionals can
 * be user values (org names, emails, IDs), so including them would leak data
 * and explode telemetry cardinality. Returns 'root' when no command token is
 * present (e.g. `--help` alone).
 */
export function resolveCommandNameFromRawArgs(rawArgs: string[]): string {
  const topLevel = rawArgs.find((arg) => !arg.startsWith('-'));
  return topLevel ? resolveCanonicalName([topLevel]) : 'root';
}

export function extractUserFlags(rawArgs: string[]): string[] {
  const passedFlags = rawArgs
    .filter((arg) => {
      // `--` is the positional separator, not a flag.
      if (arg === '--') return false;
      // Long flags: --name or --name=value (must start with a letter, so
      // negative numbers like -1 / --1 are not mistaken for flags).
      if (/^--[A-Za-z][\w-]*(=.*)?$/.test(arg)) return true;
      // Short flags: a single letter, e.g. -v.
      if (/^-[A-Za-z]$/.test(arg)) return true;
      return false;
    })
    .map((arg) => arg.replace(/^-+/, '').split('=')[0])
    .filter(Boolean);
  return [...new Set(passedFlags)];
}
