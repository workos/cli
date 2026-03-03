import yargs from 'yargs';
import type { Argv } from 'yargs';

interface YargsOptions {
  demandedOptions: Record<string, unknown>;
  string: string[];
  number: string[];
  boolean: string[];
}

/**
 * Register a subcommand with auto-enriched usage string.
 * Replays the builder on a probe yargs instance to discover demandOption fields,
 * then appends them to the usage string so parent help shows required args.
 */
export function registerSubcommand<T>(
  parentYargs: Argv<T>,
  usage: string,
  description: string,
  builder: (y: Argv) => Argv,
  handler: (argv: any) => Promise<void>,
): Argv<T> {
  let enrichedUsage = usage;

  try {
    const probe = yargs([]);
    builder(probe);
    // getOptions() exists at runtime but is not in yargs' public type definitions
    const opts = (probe as unknown as { getOptions(): YargsOptions }).getOptions();
    const demanded = Object.keys(opts.demandedOptions || {}).filter((k) => !['help', 'version'].includes(k));

    const requiredSuffix = demanded
      .map((k) => {
        const type = opts.string.includes(k)
          ? 'string'
          : opts.number.includes(k)
            ? 'number'
            : opts.boolean.includes(k)
              ? 'boolean'
              : 'value';
        return `--${k} <${type}>`;
      })
      .join(' ');

    if (requiredSuffix) {
      enrichedUsage = `${usage} ${requiredSuffix}`;
    }
  } catch {
    // Builder threw during probe — fall back to unenriched usage
  }

  return parentYargs.command(enrichedUsage, description, builder, handler);
}
