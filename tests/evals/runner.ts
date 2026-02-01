import { NextjsGrader } from './graders/nextjs.grader.js';
import { ReactGrader } from './graders/react.grader.js';
import { ReactRouterGrader } from './graders/react-router.grader.js';
import { TanstackGrader } from './graders/tanstack.grader.js';
import { VanillaGrader } from './graders/vanilla.grader.js';
import { saveResults } from './history.js';
import { ParallelRunner } from './parallel-runner.js';
import { renderDashboard } from './dashboard/index.js';
import { LogWriter } from './log-writer.js';
import type { EvalResult, EvalOptions, Grader } from './types.js';

interface Scenario {
  framework: string;
  state: string;
  grader: new (workDir: string) => Grader;
}

const SCENARIOS: Scenario[] = [
  // Next.js
  { framework: 'nextjs', state: 'fresh', grader: NextjsGrader },
  { framework: 'nextjs', state: 'existing', grader: NextjsGrader },
  { framework: 'nextjs', state: 'existing-auth0', grader: NextjsGrader },

  // React SPA
  { framework: 'react', state: 'fresh', grader: ReactGrader },
  { framework: 'react', state: 'existing', grader: ReactGrader },
  { framework: 'react', state: 'existing-auth0', grader: ReactGrader },

  // React Router
  { framework: 'react-router', state: 'fresh', grader: ReactRouterGrader },
  { framework: 'react-router', state: 'existing', grader: ReactRouterGrader },
  { framework: 'react-router', state: 'existing-auth0', grader: ReactRouterGrader },

  // TanStack Start
  { framework: 'tanstack-start', state: 'fresh', grader: TanstackGrader },
  { framework: 'tanstack-start', state: 'existing', grader: TanstackGrader },
  { framework: 'tanstack-start', state: 'existing-auth0', grader: TanstackGrader },

  // Vanilla JS
  { framework: 'vanilla-js', state: 'fresh', grader: VanillaGrader },
  { framework: 'vanilla-js', state: 'existing', grader: VanillaGrader },
  { framework: 'vanilla-js', state: 'existing-auth0', grader: VanillaGrader },
];

export interface ExtendedEvalOptions extends EvalOptions {
  keep?: boolean;
  keepOnFail?: boolean;
  retry?: number;
  noDashboard?: boolean;
  debug?: boolean;
}

export async function runEvals(options: ExtendedEvalOptions): Promise<EvalResult[]> {
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

  // Print log file location
  console.log(`\nDetailed log: ${logWriter.getFilePath()}`);

  logWriter.cleanup();

  // Save results
  const filepath = await saveResults(results, {
    framework: options.framework,
    state: options.state,
  });
  console.log(`Results saved to: ${filepath}`);

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
