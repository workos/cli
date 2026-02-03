export interface CliOptions {
  framework?: string;
  state?: string;
  verbose: boolean;
  debug: boolean;
  json: boolean;
  help: boolean;
  keep: boolean;
  keepOnFail: boolean;
  retry: number;
  noRetry: boolean;
  sequential: boolean;
  noDashboard: boolean;
  noFail: boolean;
  quality: boolean;
  command?: 'run' | 'history' | 'compare' | 'diff' | 'prune' | 'logs' | 'show';
  compareIds?: [string, string];
  logFile?: string;
  limit?: number;
  pruneKeep?: number;
}

const FRAMEWORKS = ['nextjs', 'react', 'react-router', 'tanstack-start', 'vanilla-js'];
const STATES = ['example', 'example-auth0'];

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    verbose: false,
    debug: false,
    json: false,
    help: false,
    keep: false,
    keepOnFail: false,
    retry: 2,
    noRetry: false,
    sequential: false,
    noDashboard: false,
    noFail: false,
    quality: false,
  };

  // Check for subcommands
  if (args[0] === 'history') {
    options.command = 'history';
    // Parse --limit=N option
    for (const arg of args.slice(1)) {
      if (arg.startsWith('--limit=')) {
        options.limit = parseInt(arg.split('=')[1], 10);
      }
    }
    return options;
  }

  // Support both 'compare' (legacy) and 'diff' (new)
  if ((args[0] === 'compare' || args[0] === 'diff') && args.length >= 3) {
    options.command = 'diff';
    options.compareIds = [args[1], args[2]];
    return options;
  }

  if (args[0] === 'prune') {
    options.command = 'prune';
    // Parse --keep=N option
    for (const arg of args.slice(1)) {
      if (arg.startsWith('--keep=')) {
        options.pruneKeep = parseInt(arg.split('=')[1], 10);
      }
    }
    return options;
  }

  if (args[0] === 'logs') {
    options.command = 'logs';
    return options;
  }

  if (args[0] === 'show' && args[1]) {
    options.command = 'show';
    options.logFile = args[1];
    return options;
  }

  options.command = 'run';

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--debug') {
      options.debug = true;
      options.verbose = true;
      options.keepOnFail = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--keep') {
      options.keep = true;
    } else if (arg === '--keep-on-fail') {
      options.keepOnFail = true;
    } else if (arg === '--no-retry') {
      options.noRetry = true;
    } else if (arg.startsWith('--retry=')) {
      options.retry = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--framework=')) {
      const framework = arg.split('=')[1];
      if (!FRAMEWORKS.includes(framework)) {
        throw new Error(`Unknown framework: ${framework}. Valid: ${FRAMEWORKS.join(', ')}`);
      }
      options.framework = framework;
    } else if (arg.startsWith('--state=')) {
      const state = arg.split('=')[1];
      if (!STATES.includes(state)) {
        throw new Error(`Unknown state: ${state}. Valid: ${STATES.join(', ')}`);
      }
      options.state = state;
    } else if (arg === '--sequential') {
      options.sequential = true;
    } else if (arg === '--no-dashboard') {
      options.noDashboard = true;
    } else if (arg === '--no-fail') {
      options.noFail = true;
    } else if (arg === '--quality' || arg === '-q') {
      options.quality = true;
    }
  }

  if (options.noRetry) {
    options.retry = 0;
  }

  return options;
}

export function printHelp(): void {
  console.log(`
Usage: pnpm eval [command] [options]

Commands:
  run (default)       Run evaluations
  history             List recent eval runs (--limit=N)
  diff <id1> <id2>    Compare two eval runs with correlation analysis
  prune               Delete old results (--keep=N, default 10)
  logs                List recent detailed log files
  show <file>         Display formatted log summary

Options:
  --framework=<name>  Run only scenarios for this framework
                      Valid: ${FRAMEWORKS.join(', ')}

  --state=<state>     Run only scenarios for this project state
                      Valid: ${STATES.join(', ')}

  --verbose, -v       Show detailed output including agent tool calls

  --debug             Extra verbose, preserve temp dirs on failure

  --keep              Always preserve temp directory (for manual testing)

  --keep-on-fail      Don't cleanup temp directory when scenario fails

  --retry=<n>         Number of retry attempts (default: 2)

  --no-retry          Disable retries

  --sequential        Run scenarios sequentially (disable parallelism)

  --no-dashboard      Disable live dashboard, use sequential logging

  --no-fail           Exit 0 even if success criteria thresholds not met

  --quality, -q       Enable LLM-based quality grading (adds cost/time)

  --json              Output results as JSON (for scripting)

  --help, -h          Show this help message

Examples:
  pnpm eval                           # Run all 10 scenarios
  pnpm eval --framework=nextjs        # Run only Next.js scenarios
  pnpm eval --state=example           # Run only example app scenarios
  pnpm eval --framework=react --state=example-auth0
                                      # Run specific scenario
  pnpm eval --debug                   # Verbose output, keep failed dirs
  pnpm eval --retry=3                 # More retry attempts
  pnpm eval:history                   # List recent runs
  pnpm eval:history --limit=20        # Show more runs
  pnpm eval:diff <id1> <id2>          # Compare two runs
  pnpm eval:prune --keep=5            # Keep only 5 most recent runs
`);
}
