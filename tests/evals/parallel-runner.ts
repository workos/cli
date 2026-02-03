import pLimit from 'p-limit';
import type { EvalResult, Grader, GradeCheck, ToolCall } from './types.js';
import { FixtureManager } from './fixture-manager.js';
import { AgentExecutor } from './agent-executor.js';
import { detectConcurrency } from './concurrency.js';
import { evalEvents } from './events.js';
import { collectKeyFiles } from './graders/collect-key-files.js';

interface Scenario {
  framework: string;
  state: string;
  grader: new (workDir: string) => Grader;
}

interface ParallelRunnerOptions {
  maxAttempts: number;
  verbose?: boolean;
  keep?: boolean;
  keepOnFail?: boolean;
  concurrency?: number; // Override auto-detection
}

export class ParallelRunner {
  private scenarios: Scenario[];
  private options: ParallelRunnerOptions;
  private concurrency: number;
  private activeFixtures: Set<FixtureManager> = new Set();
  private isShuttingDown = false;

  constructor(scenarios: Scenario[], options: ParallelRunnerOptions) {
    this.scenarios = scenarios;
    this.options = options;

    const concurrencyInfo = detectConcurrency();
    this.concurrency = options.concurrency ?? concurrencyInfo.effective;

    console.log(`Running with concurrency: ${this.concurrency} (${concurrencyInfo.reason})`);

    this.setupShutdownHandler();
  }

  getConcurrency(): number {
    return this.concurrency;
  }

  async run(): Promise<EvalResult[]> {
    const startTime = Date.now();
    let completed = 0;
    const limit = pLimit(this.concurrency);

    // Emit progress updates every 500ms
    const progressInterval = setInterval(() => {
      evalEvents.emitProgress({
        completed,
        total: this.scenarios.length,
        running: this.activeFixtures.size,
        elapsed: Date.now() - startTime,
      });
    }, 500);

    const tasks = this.scenarios.map((scenario) =>
      limit(async () => {
        const result = await this.runScenario(scenario);
        completed++;
        return result;
      }),
    );

    const results = await Promise.allSettled(tasks);

    clearInterval(progressInterval);
    evalEvents.emitRunComplete();

    return results.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      // Shouldn't happen - runScenario catches errors
      return {
        scenario: `${this.scenarios[i].framework}/${this.scenarios[i].state}`,
        passed: false,
        duration: 0,
        error: result.reason?.message ?? 'Unknown error',
      };
    });
  }

  private async runScenario(scenario: Scenario): Promise<EvalResult> {
    const scenarioName = `${scenario.framework}/${scenario.state}`;
    console.log(`Starting: ${scenarioName}`);

    let lastResult: EvalResult | null = null;
    let lastToolCalls: ToolCall[] = [];
    let attempt = 0;

    while (attempt < this.options.maxAttempts && !this.isShuttingDown) {
      attempt++;

      // Emit start/retry event
      const eventPayload = {
        scenario: scenarioName,
        framework: scenario.framework,
        state: scenario.state,
        attempt,
      };
      if (attempt === 1) {
        evalEvents.emitScenarioStart(eventPayload);
      } else {
        console.log(`[${scenarioName}] Retry attempt ${attempt}/${this.options.maxAttempts}...`);
        evalEvents.emitScenarioRetry(eventPayload);
      }

      const startTime = Date.now();
      const fixtureManager = new FixtureManager(scenario.framework, scenario.state, {
        keepOnFail: this.options.keepOnFail,
      });

      this.activeFixtures.add(fixtureManager);
      lastToolCalls = []; // Reset for this attempt

      try {
        const workDir = await fixtureManager.setup();

        const executor = new AgentExecutor(workDir, scenario.framework, {
          verbose: this.options.verbose,
          scenarioName,
        });
        const agentResult = await executor.run();
        lastToolCalls = agentResult.toolCalls;

        const grader = new scenario.grader(workDir);
        const gradeResult = await grader.grade();

        // Collect key files for quality grading (only on pass to avoid wasted effort)
        const keyFiles = gradeResult.passed ? await collectKeyFiles(workDir, scenario.framework) : undefined;

        lastResult = {
          scenario: scenarioName,
          passed: gradeResult.passed,
          duration: Date.now() - startTime,
          checks: gradeResult.checks,
          agentOutput: agentResult.output,
          attempts: attempt,
          latencyMetrics: agentResult.latencyMetrics,
          keyFiles,
        };

        if (gradeResult.passed) {
          console.log(`✓ ${scenarioName} PASSED`);
          evalEvents.emitScenarioPass({
            scenario: scenarioName,
            framework: scenario.framework,
            state: scenario.state,
            passed: true,
            duration: lastResult.duration,
            attempt,
            checks: gradeResult.checks,
            toolCalls: agentResult.toolCalls,
            agentOutput: agentResult.output,
          });
          break;
        }
      } catch (error) {
        lastResult = {
          scenario: scenarioName,
          passed: false,
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
          attempts: attempt,
        };
      } finally {
        const shouldKeep = this.options.keep || (this.options.keepOnFail && !lastResult?.passed);
        if (shouldKeep) {
          console.log(`[${scenarioName}] Temp directory preserved: ${fixtureManager.getTempDir()}`);
        } else {
          await fixtureManager.cleanup();
        }
        this.activeFixtures.delete(fixtureManager);
      }
    }

    if (lastResult && !lastResult.passed) {
      console.log(`✗ ${scenarioName} FAILED`);
      if (!this.options.verbose) {
        this.printFailureDetails(lastResult, false);
      } else {
        this.printFailureDetails(lastResult, true);
      }
      evalEvents.emitScenarioFail({
        scenario: scenarioName,
        framework: scenario.framework,
        state: scenario.state,
        passed: false,
        duration: lastResult.duration,
        attempt: lastResult.attempts ?? 1,
        checks: lastResult.checks,
        error: lastResult.error,
        toolCalls: lastToolCalls,
        agentOutput: lastResult.agentOutput,
      });
    }

    return lastResult!;
  }

  private printFailureDetails(result: EvalResult, verbose: boolean): void {
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

  private setupShutdownHandler(): void {
    const cleanup = async () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      console.log('\nInterrupted. Cleaning up...');
      await Promise.all(Array.from(this.activeFixtures).map((fm) => fm.cleanup()));
      process.exit(130);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
}
