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
import { QualityGrader } from './graders/quality-grader.js';
import { loadCredentials } from './env-loader.js';
import type { EvalResult, EvalOptions, EvalResultMetadata, Grader, QualityInput } from './types.js';

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
  quality?: boolean;
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

  // Quality grading (optional, only for passing scenarios with key files)
  if (options.quality) {
    const credentials = loadCredentials();
    const qualityGrader = new QualityGrader(credentials.anthropicApiKey);

    console.log('\nRunning quality grading on passing scenarios...');

    for (const result of results) {
      if (result.passed && result.keyFiles && result.keyFiles.size > 0) {
        const framework = result.scenario.split('/')[0];

        // Build metadata from result
        const qualityInput: QualityInput = {
          framework,
          keyFiles: result.keyFiles,
          metadata: {
            filesCreated: [], // Could be extracted from tool calls if tracked
            filesModified: [], // Could be extracted from tool calls if tracked
            toolCallSummary: buildToolCallSummary(result),
            checksPassed: result.checks?.filter((c) => c.passed).map((c) => c.name) || [],
          },
        };

        result.qualityGrade = await qualityGrader.grade(qualityInput);

        if (result.qualityGrade) {
          console.log(`  ${result.scenario}: ${result.qualityGrade.score}/5`);
          if (options.verbose) {
            for (const line of result.qualityGrade.reasoning.split('\n')) {
              console.log(`    ${line}`);
            }
          }
        }
      }
    }

    printQualitySummary(results);
  }

  // Print summary
  printSummary(results);
  printLatencySummary(results);

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

function printLatencySummary(results: EvalResult[]): void {
  const withLatency = results.filter((r) => r.latencyMetrics);
  if (withLatency.length === 0) return;

  // Extract metrics
  const ttfts = withLatency
    .map((r) => r.latencyMetrics!.ttftMs)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);

  const durations = withLatency.map((r) => r.latencyMetrics!.totalDurationMs).sort((a, b) => a - b);

  console.log('\nLatency Summary:');
  console.log('─'.repeat(40));

  if (ttfts.length > 0) {
    console.log(
      `  TTFT:     p50=${percentile(ttfts, 50)}ms, p95=${percentile(ttfts, 95)}ms, max=${ttfts[ttfts.length - 1]}ms`,
    );
  }

  console.log(
    `  Duration: p50=${percentile(durations, 50)}ms, p95=${percentile(durations, 95)}ms, max=${durations[durations.length - 1]}ms`,
  );

  // Aggregate tool breakdown across all runs
  const toolTotals = new Map<string, { durationMs: number; count: number }>();
  for (const result of withLatency) {
    for (const tool of result.latencyMetrics!.toolBreakdown || []) {
      const existing = toolTotals.get(tool.tool) || { durationMs: 0, count: 0 };
      toolTotals.set(tool.tool, {
        durationMs: existing.durationMs + tool.durationMs,
        count: existing.count + tool.count,
      });
    }
  }

  if (toolTotals.size > 0) {
    console.log('\nTool Time Breakdown (total across all scenarios):');
    const sorted = Array.from(toolTotals.entries()).sort((a, b) => b[1].durationMs - a[1].durationMs);
    for (const [tool, data] of sorted.slice(0, 5)) {
      console.log(`  ${tool}: ${(data.durationMs / 1000).toFixed(1)}s (${data.count} calls)`);
    }
  }
}

function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
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

function printQualitySummary(results: EvalResult[]): void {
  const withQuality = results.filter((r) => r.qualityGrade);
  if (withQuality.length === 0) return;

  console.log('\nQuality Summary:');
  console.log('─'.repeat(40));

  // Average by dimension
  const dimensionSums = { codeStyle: 0, minimalism: 0, errorHandling: 0, idiomatic: 0 };
  for (const result of withQuality) {
    for (const [dim, score] of Object.entries(result.qualityGrade!.dimensions)) {
      dimensionSums[dim as keyof typeof dimensionSums] += score;
    }
  }

  for (const [dim, sum] of Object.entries(dimensionSums)) {
    const avg = sum / withQuality.length;
    console.log(`  ${dim}: ${avg.toFixed(1)}/5`);
  }

  const overallAvg = withQuality.reduce((sum, r) => sum + r.qualityGrade!.score, 0) / withQuality.length;
  console.log(`\n  Overall: ${overallAvg.toFixed(1)}/5`);
}

function buildToolCallSummary(result: EvalResult): string {
  // We don't have tool call data on EvalResult currently,
  // but latencyMetrics.toolBreakdown has aggregate counts
  const breakdown = result.latencyMetrics?.toolBreakdown;
  if (!breakdown || breakdown.length === 0) {
    return 'No tool call data';
  }

  return breakdown.map((t) => `${t.count} ${t.tool}`).join(', ');
}
