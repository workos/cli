import { FixtureManager } from './fixture-manager.js';
import { AgentExecutor } from './agent-executor.js';
import { NextjsGrader } from './graders/nextjs.grader.js';
import { ReactGrader } from './graders/react.grader.js';
import { ReactRouterGrader } from './graders/react-router.grader.js';
import { TanstackGrader } from './graders/tanstack.grader.js';
import { VanillaGrader } from './graders/vanilla.grader.js';
import { saveResults } from './history.js';
import type { EvalResult, EvalOptions, Grader, GradeCheck } from './types.js';

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
}

export async function runEvals(options: ExtendedEvalOptions): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  const maxAttempts = (options.retry ?? 2) + 1;

  const scenarios = SCENARIOS.filter(
    (s) => (!options.framework || s.framework === options.framework) && (!options.state || s.state === options.state),
  );

  for (const scenario of scenarios) {
    console.log(`\nRunning: ${scenario.framework}/${scenario.state}`);

    let lastResult: EvalResult | null = null;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      if (attempt > 1) {
        console.log(`  Retry attempt ${attempt}/${maxAttempts}...`);
      }

      const startTime = Date.now();
      const fixtureManager = new FixtureManager(scenario.framework, scenario.state, {
        keepOnFail: options.keepOnFail,
      });

      try {
        const workDir = await fixtureManager.setup();

        const executor = new AgentExecutor(workDir, scenario.framework, {
          verbose: options.verbose,
        });
        const agentResult = await executor.run();

        const grader = new scenario.grader(workDir);
        const gradeResult = await grader.grade();

        lastResult = {
          scenario: `${scenario.framework}/${scenario.state}`,
          passed: gradeResult.passed,
          duration: Date.now() - startTime,
          checks: gradeResult.checks,
          agentOutput: agentResult.output,
          attempts: attempt,
        };

        if (gradeResult.passed) {
          break; // Success, no more retries needed
        }
      } catch (error) {
        lastResult = {
          scenario: `${scenario.framework}/${scenario.state}`,
          passed: false,
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
          attempts: attempt,
        };
      } finally {
        const shouldKeep = options.keep || (options.keepOnFail && !lastResult?.passed);
        if (shouldKeep) {
          console.log(`  Temp directory preserved: ${fixtureManager.getTempDir()}`);
        } else {
          await fixtureManager.cleanup();
        }
      }
    }

    if (lastResult) {
      results.push(lastResult);
      const status = lastResult.passed ? '✓ PASSED' : '✗ FAILED';
      const attemptInfo =
        lastResult.attempts && lastResult.attempts > 1 ? ` (attempt ${lastResult.attempts}/${maxAttempts})` : '';
      console.log(`${status}${attemptInfo}`);

      if (!lastResult.passed && !options.verbose) {
        printFailureDetails(lastResult, false);
      } else if (!lastResult.passed && options.verbose) {
        printFailureDetails(lastResult, true);
      }
    }
  }

  // Save results (skip in json mode since caller handles output)
  const filepath = await saveResults(results, {
    framework: options.framework,
    state: options.state,
  });
  console.log(`\nResults saved to: ${filepath}`);

  return results;
}

function printFailureDetails(result: EvalResult, verbose: boolean): void {
  if (result.error) {
    console.log(`  Error: ${result.error}`);
  } else if (result.checks) {
    const failedChecks = result.checks.filter((c: GradeCheck) => !c.passed);
    for (const check of failedChecks) {
      console.log(`  - ${check.name}: ${check.message}`);
      if (verbose && check.expected) {
        console.log(`    Expected: ${check.expected}`);
      }
      if (verbose && check.actual) {
        console.log(`    Actual: ${check.actual}`);
      }
    }
  }
}
