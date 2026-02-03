import chalk from 'chalk';
import type { EvalRun } from '../history.js';
import type { EvalResultMetadata, LatencyMetrics, QualityGrade } from '../types.js';

export interface DiffResult {
  passRateDelta: {
    firstAttempt: number;
    withRetry: number;
  };
  skillChanges: Array<{
    framework: string;
    oldHash: string;
    newHash: string;
  }>;
  scenarioChanges: {
    regressions: string[];
    improvements: string[];
    unchanged: string[];
  };
  latencyChanges?: {
    ttftP50Delta: number;
    ttftP95Delta: number;
    durationP50Delta: number;
    durationP95Delta: number;
  };
  qualityChanges?: {
    overallDelta: number;
    dimensionDeltas: Record<string, number>;
  };
  likelyCauses: string[];
}

export function diffRuns(run1: EvalRun, run2: EvalRun): DiffResult {
  // Calculate pass rate deltas
  const passRateDelta = {
    firstAttempt: calculateFirstAttemptRate(run2) - calculateFirstAttemptRate(run1),
    withRetry: run2.summary.passRate - run1.summary.passRate,
  };

  // Find skill version changes
  const skillChanges = findSkillChanges(run1.metadata, run2.metadata);

  // Find scenario status changes
  const scenarioChanges = findScenarioChanges(run1, run2);

  // Calculate latency changes (if available)
  const latencyChanges = calculateLatencyChanges(run1, run2);

  // Calculate quality changes (if available)
  const qualityChanges = calculateQualityChanges(run1, run2);

  // Determine likely causes
  const likelyCauses = determineLikelyCauses(skillChanges, scenarioChanges, passRateDelta);

  return {
    passRateDelta,
    skillChanges,
    scenarioChanges,
    latencyChanges,
    qualityChanges,
    likelyCauses,
  };
}

function calculateFirstAttemptRate(run: EvalRun): number {
  const firstAttemptPassed = run.results.filter((r) => r.attempts === 1 && r.passed).length;
  return run.results.length > 0 ? firstAttemptPassed / run.results.length : 0;
}

function findSkillChanges(
  meta1?: EvalResultMetadata,
  meta2?: EvalResultMetadata,
): Array<{ framework: string; oldHash: string; newHash: string }> {
  if (!meta1?.skillVersions || !meta2?.skillVersions) return [];

  const changes: Array<{ framework: string; oldHash: string; newHash: string }> = [];

  for (const [framework, newHash] of Object.entries(meta2.skillVersions)) {
    const oldHash = meta1.skillVersions[framework] || 'unknown';
    if (oldHash !== newHash) {
      changes.push({ framework, oldHash, newHash });
    }
  }

  return changes;
}

function findScenarioChanges(
  run1: EvalRun,
  run2: EvalRun,
): { regressions: string[]; improvements: string[]; unchanged: string[] } {
  const results1 = new Map(run1.results.map((r) => [r.scenario, r.passed]));
  const results2 = new Map(run2.results.map((r) => [r.scenario, r.passed]));

  const regressions: string[] = [];
  const improvements: string[] = [];
  const unchanged: string[] = [];

  for (const [scenario, passed2] of results2) {
    const passed1 = results1.get(scenario);
    if (passed1 === true && passed2 === false) {
      regressions.push(scenario);
    } else if (passed1 === false && passed2 === true) {
      improvements.push(scenario);
    } else {
      unchanged.push(scenario);
    }
  }

  return { regressions, improvements, unchanged };
}

function calculateLatencyChanges(
  run1: EvalRun,
  run2: EvalRun,
): DiffResult['latencyChanges'] | undefined {
  const latencies1 = run1.results.map((r) => r.latencyMetrics).filter(Boolean) as LatencyMetrics[];
  const latencies2 = run2.results.map((r) => r.latencyMetrics).filter(Boolean) as LatencyMetrics[];

  if (latencies1.length === 0 || latencies2.length === 0) return undefined;

  const ttfts1 = latencies1.map((l) => l.ttftMs).filter((t): t is number => t !== null);
  const ttfts2 = latencies2.map((l) => l.ttftMs).filter((t): t is number => t !== null);
  const durations1 = latencies1.map((l) => l.totalDurationMs);
  const durations2 = latencies2.map((l) => l.totalDurationMs);

  if (ttfts1.length === 0 || ttfts2.length === 0) return undefined;

  return {
    ttftP50Delta: percentile(ttfts2, 50) - percentile(ttfts1, 50),
    ttftP95Delta: percentile(ttfts2, 95) - percentile(ttfts1, 95),
    durationP50Delta: percentile(durations2, 50) - percentile(durations1, 50),
    durationP95Delta: percentile(durations2, 95) - percentile(durations1, 95),
  };
}

function calculateQualityChanges(
  run1: EvalRun,
  run2: EvalRun,
): DiffResult['qualityChanges'] | undefined {
  const grades1 = run1.results.map((r) => r.qualityGrade).filter(Boolean) as QualityGrade[];
  const grades2 = run2.results.map((r) => r.qualityGrade).filter(Boolean) as QualityGrade[];

  if (grades1.length === 0 || grades2.length === 0) return undefined;

  const avgScore1 = grades1.reduce((s, g) => s + g.score, 0) / grades1.length;
  const avgScore2 = grades2.reduce((s, g) => s + g.score, 0) / grades2.length;

  // Calculate dimension averages
  const dims = ['codeStyle', 'minimalism', 'errorHandling', 'idiomatic'] as const;
  const dimensionDeltas: Record<string, number> = {};

  for (const dim of dims) {
    const avg1 = grades1.reduce((s, g) => s + g.dimensions[dim], 0) / grades1.length;
    const avg2 = grades2.reduce((s, g) => s + g.dimensions[dim], 0) / grades2.length;
    dimensionDeltas[dim] = avg2 - avg1;
  }

  return {
    overallDelta: avgScore2 - avgScore1,
    dimensionDeltas,
  };
}

function determineLikelyCauses(
  skillChanges: Array<{ framework: string; oldHash: string; newHash: string }>,
  scenarioChanges: { regressions: string[] },
  passRateDelta: { firstAttempt: number; withRetry: number },
): string[] {
  const causes: string[] = [];

  // If pass rate dropped AND skill changed, correlate
  if (passRateDelta.withRetry < -0.05) {
    // >5% drop
    for (const change of skillChanges) {
      const relatedRegressions = scenarioChanges.regressions.filter((s) =>
        s.startsWith(change.framework),
      );
      if (relatedRegressions.length > 0) {
        causes.push(
          `${change.framework} skill changed (${change.oldHash.slice(0, 8)} → ${change.newHash.slice(0, 8)}) ` +
            `and ${relatedRegressions.length} scenario(s) regressed`,
        );
      }
    }
  }

  // No skill changes but regressions occurred
  if (skillChanges.length === 0 && scenarioChanges.regressions.length > 0) {
    causes.push('Regressions occurred without skill changes - possible flaky tests or external factors');
  }

  return causes;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function printDiff(diff: DiffResult, run1Id: string, run2Id: string): void {
  console.log(chalk.bold(`\nComparing: ${run1Id} → ${run2Id}\n`));

  // Pass rate changes
  console.log(chalk.bold('Pass Rate Changes:'));
  printDelta('  First-attempt', diff.passRateDelta.firstAttempt * 100, '%');
  printDelta('  With-retry', diff.passRateDelta.withRetry * 100, '%');

  // Skill changes
  if (diff.skillChanges.length > 0) {
    console.log(chalk.bold('\nSkill Version Changes:'));
    for (const change of diff.skillChanges) {
      console.log(
        `  ${change.framework}: ${change.oldHash.slice(0, 8)} → ${change.newHash.slice(0, 8)}`,
      );
    }
  }

  // Scenario changes
  if (diff.scenarioChanges.regressions.length > 0) {
    console.log(chalk.bold.red('\nRegressions (PASS → FAIL):'));
    for (const s of diff.scenarioChanges.regressions) {
      console.log(chalk.red(`  ✗ ${s}`));
    }
  }

  if (diff.scenarioChanges.improvements.length > 0) {
    console.log(chalk.bold.green('\nImprovements (FAIL → PASS):'));
    for (const s of diff.scenarioChanges.improvements) {
      console.log(chalk.green(`  ✓ ${s}`));
    }
  }

  // Latency changes
  if (diff.latencyChanges) {
    console.log(chalk.bold('\nLatency Changes:'));
    printDelta('  TTFT p50', diff.latencyChanges.ttftP50Delta, 'ms');
    printDelta('  TTFT p95', diff.latencyChanges.ttftP95Delta, 'ms');
    printDelta('  Duration p50', diff.latencyChanges.durationP50Delta / 1000, 's');
    printDelta('  Duration p95', diff.latencyChanges.durationP95Delta / 1000, 's');
  }

  // Quality changes
  if (diff.qualityChanges) {
    console.log(chalk.bold('\nQuality Changes:'));
    printDelta('  Overall', diff.qualityChanges.overallDelta, '/5');
    for (const [dim, delta] of Object.entries(diff.qualityChanges.dimensionDeltas)) {
      printDelta(`    ${dim}`, delta, '/5');
    }
  }

  // Likely causes
  if (diff.likelyCauses.length > 0) {
    console.log(chalk.bold.yellow('\nLikely Causes:'));
    for (const cause of diff.likelyCauses) {
      console.log(chalk.yellow(`  ⚠ ${cause}`));
    }
  }

  // Summary
  const totalChanges =
    diff.scenarioChanges.regressions.length + diff.scenarioChanges.improvements.length;
  if (totalChanges === 0 && diff.skillChanges.length === 0) {
    console.log(chalk.gray('\nNo significant changes between runs.'));
  }
}

function printDelta(label: string, delta: number, unit: string): void {
  const sign = delta > 0 ? '+' : '';
  const color = delta > 0 ? chalk.green : delta < 0 ? chalk.red : chalk.gray;
  console.log(`${label}: ${color(`${sign}${delta.toFixed(1)}${unit}`)}`);
}
