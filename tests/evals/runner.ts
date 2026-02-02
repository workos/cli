import { NextjsGrader } from './graders/nextjs.grader.js';
import { ReactGrader } from './graders/react.grader.js';
import { ReactRouterGrader } from './graders/react-router.grader.js';
import { TanstackGrader } from './graders/tanstack.grader.js';
import { VanillaGrader } from './graders/vanilla.grader.js';
import { saveResults } from './history.js';
import { ParallelRunner } from './parallel-runner.js';
import { renderDashboard } from './dashboard/index.js';
import { LogWriter } from './log-writer.js';
import { validateResults, type ValidationResult } from './success-criteria.js';
import { captureVersionMetadata } from './versioning.js';
import type { EvalResult, EvalOptions, EvalResultMetadata, Grader } from './types.js';

interface Scenario {
  framework: string;
  state: string;
  grader: new (workDir: string) => Grader;
}

const SCENARIOS: Scenario[] = [
  // Next.js (5 states)
  { framework: 'nextjs', state: 'example', grader: NextjsGrader },
  { framework: 'nextjs', state: 'example-auth0', grader: NextjsGrader },
  { framework: 'nextjs', state: 'partial-install', grader: NextjsGrader },
  { framework: 'nextjs', state: 'typescript-strict', grader: NextjsGrader },
  { framework: 'nextjs', state: 'conflicting-middleware', grader: NextjsGrader },

  // React SPA (5 states)
  { framework: 'react', state: 'example', grader: ReactGrader },
  { framework: 'react', state: 'example-auth0', grader: ReactGrader },
  { framework: 'react', state: 'partial-install', grader: ReactGrader },
  { framework: 'react', state: 'typescript-strict', grader: ReactGrader },
  { framework: 'react', state: 'conflicting-auth', grader: ReactGrader },

  // React Router (5 states)
  { framework: 'react-router', state: 'example', grader: ReactRouterGrader },
  { framework: 'react-router', state: 'example-auth0', grader: ReactRouterGrader },
  { framework: 'react-router', state: 'partial-install', grader: ReactRouterGrader },
  { framework: 'react-router', state: 'typescript-strict', grader: ReactRouterGrader },
  { framework: 'react-router', state: 'conflicting-middleware', grader: ReactRouterGrader },

  // TanStack Start (5 states)
  { framework: 'tanstack-start', state: 'example', grader: TanstackGrader },
  { framework: 'tanstack-start', state: 'example-auth0', grader: TanstackGrader },
  { framework: 'tanstack-start', state: 'partial-install', grader: TanstackGrader },
  { framework: 'tanstack-start', state: 'typescript-strict', grader: TanstackGrader },
  { framework: 'tanstack-start', state: 'conflicting-middleware', grader: TanstackGrader },

  // Vanilla JS (4 states - no TypeScript)
  { framework: 'vanilla-js', state: 'example', grader: VanillaGrader },
  { framework: 'vanilla-js', state: 'example-auth0', grader: VanillaGrader },
  { framework: 'vanilla-js', state: 'partial-install', grader: VanillaGrader },
  { framework: 'vanilla-js', state: 'conflicting-auth', grader: VanillaGrader },
];

export interface ExtendedEvalOptions extends EvalOptions {
  keep?: boolean;
  keepOnFail?: boolean;
  retry?: number;
  noDashboard?: boolean;
  debug?: boolean;
  noFail?: boolean;
}

export async function runEvals(options: ExtendedEvalOptions): Promise<EvalResult[]> {
  // Capture version metadata at start
  const versionMeta = await captureVersionMetadata();
  const metadata: EvalResultMetadata = {
    ...versionMeta,
    timestamp: new Date().toISOString(),
  };

  const scenarios = SCENARIOS.filter(
    (s) => (!options.framework || s.framework === options.framework) && (!options.state || s.state === options.state),
  );

  const maxAttempts = (options.retry ?? 2) + 1;

  // Use ParallelRunner for execution
  const runner = new ParallelRunner(scenarios, {
    maxAttempts,
    verbose: options.verbose,
    keep: options.keep,
    keepOnFail: options.keepOnFail,
    concurrency: options.sequential ? 1 : undefined,
  });

  // Initialize log writer
  const logWriter = new LogWriter({
    concurrency: runner.getConcurrency(),
    cliFlags: {
      framework: options.framework,
      state: options.state,
      verbose: options.verbose,
      debug: options.debug,
      retry: options.retry,
    },
  });

  // Determine output mode: dashboard for TTY, logging otherwise
  const useDashboard = !options.noDashboard && process.stdout.isTTY;

  let dashboard: { unmount: () => void } | null = null;
  if (useDashboard) {
    dashboard = renderDashboard({
      scenarios: scenarios.map((s) => ({ framework: s.framework, state: s.state })),
      concurrency: runner.getConcurrency(),
    });
  }

  const results = await runner.run();

  if (dashboard) {
    dashboard.unmount();
  }

  // Print summary
  printSummary(results);

  // Validate against success criteria
  const validation = validateResults(results);
  printValidationSummary(validation);

  // Print log file location
  console.log(`\nDetailed log: ${logWriter.getFilePath()}`);

  logWriter.cleanup();

  // Save results with metadata
  const filepath = await saveResults(
    results,
    {
      framework: options.framework,
      state: options.state,
    },
    metadata,
  );
  console.log(`Results saved to: ${filepath}`);

  // Exit with error if thresholds not met (unless --no-fail)
  if (!validation.passed && !options.noFail) {
    process.exitCode = 1;
  }

  return results;
}

function printSummary(results: EvalResult[]): void {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log('\n' + '─'.repeat(50));
  console.log(`Summary: ${passed}/${results.length} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\nFailed scenarios:');
    for (const result of results.filter((r) => !r.passed)) {
      const attempts = result.attempts && result.attempts > 1 ? ` (${result.attempts} attempts)` : '';
      console.log(`  ✗ ${result.scenario}${attempts}`);
    }
  }
}

function printValidationSummary(validation: ValidationResult): void {
  console.log('\n' + '═'.repeat(50));
  if (validation.passed) {
    console.log('✓ PASS: All success criteria met');
  } else {
    console.log('✗ FAIL: Success criteria not met');
    for (const failure of validation.failures) {
      console.log(`  - ${failure}`);
    }
  }
  console.log(
    `\nFirst-attempt: ${(validation.actual.firstAttemptPassRate * 100).toFixed(1)}% (required: ${validation.criteria.firstAttemptPassRate * 100}%)`,
  );
  console.log(
    `With-retry:    ${(validation.actual.withRetryPassRate * 100).toFixed(1)}% (required: ${validation.criteria.withRetryPassRate * 100}%)`,
  );
  console.log('═'.repeat(50));
}
