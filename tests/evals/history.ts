import { writeFile, readFile, readdir, symlink, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvalResult } from './types.js';

const RESULTS_DIR = join(process.cwd(), 'tests/eval-results');

export interface EvalRun {
  id: string;
  timestamp: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  };
  options: {
    framework?: string;
    state?: string;
  };
  results: EvalResult[];
}

export async function saveResults(
  results: EvalResult[],
  options: { framework?: string; state?: string }
): Promise<string> {
  // Ensure results directory exists
  await mkdir(RESULTS_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}.json`;
  const filepath = join(RESULTS_DIR, filename);

  const run: EvalRun = {
    id: timestamp,
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      passRate: results.length > 0 ? results.filter((r) => r.passed).length / results.length : 0,
    },
    options,
    results,
  };

  await writeFile(filepath, JSON.stringify(run, null, 2));

  // Update latest symlink
  const latestPath = join(RESULTS_DIR, 'latest.json');
  try {
    await unlink(latestPath);
  } catch {
    // Ignore if doesn't exist
  }
  await symlink(filename, latestPath);

  return filepath;
}

export async function loadRun(id: string): Promise<EvalRun> {
  const filepath =
    id === 'latest' ? join(RESULTS_DIR, 'latest.json') : join(RESULTS_DIR, `${id}.json`);

  const content = await readFile(filepath, 'utf-8');
  return JSON.parse(content);
}

export async function listRuns(): Promise<string[]> {
  try {
    const files = await readdir(RESULTS_DIR);
    return files
      .filter((f) => f.endsWith('.json') && f !== 'latest.json')
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function compareRuns(run1: EvalRun, run2: EvalRun): void {
  console.log(`\nComparing ${run1.id} vs ${run2.id}\n`);

  console.log('Summary:');
  console.log(
    `  Run 1: ${run1.summary.passed}/${run1.summary.total} (${(run1.summary.passRate * 100).toFixed(1)}%)`
  );
  console.log(
    `  Run 2: ${run2.summary.passed}/${run2.summary.total} (${(run2.summary.passRate * 100).toFixed(1)}%)`
  );

  const diff = run2.summary.passRate - run1.summary.passRate;
  const trend = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  console.log(`  Trend: ${trend} ${Math.abs(diff * 100).toFixed(1)}%`);

  // Find regressions and improvements
  const results1 = new Map(run1.results.map((r) => [r.scenario, r.passed]));
  const results2 = new Map(run2.results.map((r) => [r.scenario, r.passed]));

  const regressions: string[] = [];
  const improvements: string[] = [];

  for (const [scenario, passed2] of results2) {
    const passed1 = results1.get(scenario);
    if (passed1 === true && passed2 === false) {
      regressions.push(scenario);
    } else if (passed1 === false && passed2 === true) {
      improvements.push(scenario);
    }
  }

  if (regressions.length > 0) {
    console.log('\nRegressions (was passing, now failing):');
    for (const s of regressions) {
      console.log(`  ✗ ${s}`);
    }
  }

  if (improvements.length > 0) {
    console.log('\nImprovements (was failing, now passing):');
    for (const s of improvements) {
      console.log(`  ✓ ${s}`);
    }
  }

  if (regressions.length === 0 && improvements.length === 0) {
    console.log('\nNo changes in pass/fail status.');
  }
}
