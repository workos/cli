import { COMMAND_ALIASES } from '../lib/command-aliases.js';
import { getTopLevelCommandNames } from './help-json.js';

let knownTopLevelCommands: Set<string> | null = null;

/** Canonical top-level command heads (registry + alias targets), memoized. */
function topLevelCommands(): Set<string> {
  if (!knownTopLevelCommands) {
    const names = new Set(getTopLevelCommandNames());
    // Alias targets resolve to a canonical head (e.g. claim -> env.claim -> env).
    for (const target of Object.values(COMMAND_ALIASES)) {
      names.add(target.split('.')[0]);
    }
    knownTopLevelCommands = names;
  }
  return knownTopLevelCommands;
}

export const SKIP_TELEMETRY_COMMANDS = new Set(['install', 'dashboard', 'root', 'telemetry']);

export function resolveCanonicalName(parts: string[]): string {
  if (parts.length === 0) return 'root';
  const resolved = [...parts];
  resolved[0] = COMMAND_ALIASES[resolved[0]] ?? resolved[0];
  return resolved.join('.');
}

/**
 * Resolve the command name from raw argv for paths where yargs validation
 * fails before middleware runs (e.g. a missing required argument).
 *
 * Returns the first token that resolves to a KNOWN top-level command. Tokens
 * are matched against the command registry rather than trusting position, so
 * an option value preceding the command (e.g. `--api-key sk_live_… org` or
 * `--mode ci org`) can never be recorded as the command name — that would leak
 * secrets/values into telemetry and explode cardinality. Anything that isn't a
 * known command (typos, stray values, `--help`) returns 'root', which is
 * skipped. Only the top-level command is recorded; later positionals can be
 * user values (org names, emails, IDs), so they are never included.
 */
export function resolveCommandNameFromRawArgs(rawArgs: string[]): string {
  const known = topLevelCommands();
  for (const token of rawArgs) {
    if (token.startsWith('-')) continue;
    const canonical = resolveCanonicalName([token]);
    if (known.has(canonical.split('.')[0])) return canonical;
  }
  return 'root';
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
