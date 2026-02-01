import { FixtureManager } from './fixture-manager.js';
import { AgentExecutor } from './agent-executor.js';
import { NextjsGrader } from './graders/nextjs.grader.js';
import { ReactGrader } from './graders/react.grader.js';
import { ReactRouterGrader } from './graders/react-router.grader.js';
import { TanstackGrader } from './graders/tanstack.grader.js';
import { VanillaGrader } from './graders/vanilla.grader.js';
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

export async function runEvals(options: EvalOptions): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  const scenarios = SCENARIOS.filter(
    (s) =>
      (!options.framework || s.framework === options.framework) &&
      (!options.state || s.state === options.state)
  );

  for (const scenario of scenarios) {
    console.log(`\nRunning: ${scenario.framework}/${scenario.state}`);
    const startTime = Date.now();

    const fixtureManager = new FixtureManager(scenario.framework, scenario.state);

    try {
      // Setup fixture in temp directory
      const workDir = await fixtureManager.setup();

      // Run agent against fixture
      const executor = new AgentExecutor(workDir, scenario.framework);
      const agentResult = await executor.run();

      // Grade the result
      const grader = new scenario.grader(workDir);
      const gradeResult = await grader.grade();

      results.push({
        scenario: `${scenario.framework}/${scenario.state}`,
        passed: gradeResult.passed,
        duration: Date.now() - startTime,
        checks: gradeResult.checks,
        agentOutput: agentResult.output,
      });

      console.log(gradeResult.passed ? '✓ PASSED' : '✗ FAILED');

      if (!gradeResult.passed) {
        for (const check of gradeResult.checks.filter((c) => !c.passed)) {
          console.log(`  - ${check.name}: ${check.message}`);
        }
      }
    } catch (error) {
      results.push({
        scenario: `${scenario.framework}/${scenario.state}`,
        passed: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log('✗ ERROR:', error);
    } finally {
      await fixtureManager.cleanup();
    }
  }

  return results;
}
