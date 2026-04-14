import { analytics } from './analytics.js';
import { COMMAND_ALIASES } from '../lib/command-aliases.js';
import { WORKOS_TELEMETRY_ENABLED } from '../lib/constants.js';

/**
 * Resolve user-typed command parts to their canonical name.
 * Applies alias mapping to the top-level command only.
 *
 * Examples:
 *   ['org', 'list'] -> 'organization.list'
 *   ['auth', 'login'] -> 'auth.login'
 *   [] -> 'root'
 */
export function resolveCanonicalName(parts: string[]): string {
  if (parts.length === 0) return 'root';
  const resolved = [...parts];
  resolved[0] = COMMAND_ALIASES[resolved[0]] ?? resolved[0];
  return resolved.join('.');
}

/**
 * Extract only user-supplied flags (not positionals, not defaults).
 * Parses rawArgs directly instead of argv to avoid positionals and camelCase dupes.
 */
export function extractUserFlags(rawArgs: string[]): string[] {
  const passedFlags = rawArgs
    .filter((arg) => arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2))
    .map((arg) => arg.replace(/^-+/, '').split('=')[0]);
  return [...new Set(passedFlags)];
}

/**
 * Yargs middleware that queues a PROVISIONAL command event immediately.
 * This ensures there's always an event to persist via store-forward,
 * even if the handler calls process.exit() before returning.
 *
 * The provisional event has success=true and duration=0. It gets
 * updated by the handler wrapper on normal completion/failure.
 */
export function commandTelemetryMiddleware(rawArgs: string[]) {
  return async (argv: Record<string, unknown>) => {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    const commandParts = (argv._ as string[]) || [];
    const commandName = resolveCanonicalName(commandParts);
    const flags = extractUserFlags(rawArgs);
    const startTime = Date.now();

    // Store metadata for the handler wrapper to update later
    argv.__telemetryCommandName = commandName;
    argv.__telemetryStartTime = startTime;
    argv.__telemetryFlags = flags;

    // Queue provisional event NOW, before the handler runs.
    // If the handler calls process.exit(), store-forward persists this.
    analytics.commandExecuted(commandName, 0, true, { flags });
  };
}

/**
 * Wraps a yargs command handler to UPDATE the provisional event
 * with actual duration and success/failure on completion.
 * Designed to be called inside registerSubcommand(), not at each call site.
 */
export function wrapCommandHandler(
  handler: (argv: any) => Promise<void>,
): (argv: any) => Promise<void> {
  return async (argv) => {
    const commandName = String(argv.__telemetryCommandName ?? 'unknown');
    const startTime = Number(argv.__telemetryStartTime ?? Date.now());
    const flags = (argv.__telemetryFlags as string[]) ?? [];

    try {
      await handler(argv);
      // Replace the provisional event with the real one
      analytics.replaceLastCommandEvent(commandName, Date.now() - startTime, true, { flags });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      analytics.replaceLastCommandEvent(commandName, Date.now() - startTime, false, {
        error: err,
        flags,
      });
      throw error;
    }
  };
}
