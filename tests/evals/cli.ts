export interface CliOptions {
  framework?: string;
  state?: string;
  verbose: boolean;
  json: boolean;
  help: boolean;
}

const FRAMEWORKS = ['nextjs', 'react', 'react-router', 'tanstack-start', 'vanilla-js'];
const STATES = ['fresh', 'existing', 'existing-auth0'];

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    verbose: false,
    json: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--json') {
      options.json = true;
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
    }
  }

  return options;
}

export function printHelp(): void {
  console.log(`
Usage: pnpm eval [options]

Options:
  --framework=<name>  Run only scenarios for this framework
                      Valid: ${FRAMEWORKS.join(', ')}

  --state=<state>     Run only scenarios for this project state
                      Valid: ${STATES.join(', ')}

  --verbose, -v       Show detailed output including agent tool calls

  --json              Output results as JSON (for scripting)

  --help, -h          Show this help message

Examples:
  pnpm eval                           # Run all 15 scenarios
  pnpm eval --framework=nextjs        # Run only Next.js scenarios
  pnpm eval --state=fresh             # Run only fresh app scenarios
  pnpm eval --framework=react --state=existing-auth0
                                      # Run specific scenario
`);
}
