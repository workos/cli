import yargs from 'yargs';
import type { Argv } from 'yargs';

interface YargsOptions {
  demandedOptions: Record<string, unknown>;
}

/**
 * Register a subcommand with auto-enriched description.
 * Replays the builder on a probe yargs instance to discover demandOption fields,
 * then appends required flag names to the description so parent help shows them.
 *
 * Note: enrichment targets the description, not the command string, because yargs
 * interprets `<...>` in command strings as required positional arguments.
 */
export function registerSubcommand<T>(
  parentYargs: Argv<T>,
  usage: string,
  description: string,
  builder: (y: Argv) => Argv,
  handler: (argv: any) => Promise<void>,
): Argv<T> {
  let enrichedDescription = description;

  try {
    const probe = yargs([]);
    builder(probe);
    // getOptions() exists at runtime but is not in yargs' public type definitions
    const opts = (probe as unknown as { getOptions(): YargsOptions }).getOptions();
    const demanded = Object.keys(opts.demandedOptions || {}).filter((k) => !['help', 'version'].includes(k));

    // Exclude flags that correspond to positionals already visible in the usage string
    const positionalNames = new Set([...usage.matchAll(/<([^>]+?)(?:\.\.\.)?>/g)].map((m) => m[1]));
    const namedOnly = demanded.filter((k) => !positionalNames.has(k));

    // Skip enrichment when the description already mentions every flag
    const newFlags = namedOnly.filter((k) => !description.includes(`--${k}`));
    if (newFlags.length > 0) {
      const flagList = newFlags.map((k) => `--${k}`).join(', ');
      enrichedDescription = `${description} (requires ${flagList})`;
    }
  } catch {
    // Builder threw during probe — fall back to unenriched description
  }

  return parentYargs.command(usage, enrichedDescription, builder, handler);
}
