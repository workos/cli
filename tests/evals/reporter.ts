import type { EvalResult } from './types.js';

const FRAMEWORKS = ['nextjs', 'react', 'react-router', 'tanstack-start', 'vanilla-js'];
const STATES = ['example', 'example-auth0'];

export function printMatrix(results: EvalResult[]): void {
  const resultMap = new Map(results.map((r) => [r.scenario, r]));

  // Header
  console.log('\n┌─────────────────┬─────────┬───────────────┐');
  console.log('│ Framework       │ Example │ Example+Auth0 │');
  console.log('├─────────────────┼─────────┼───────────────┤');

  for (const framework of FRAMEWORKS) {
    const cells = STATES.map((state) => {
      const key = `${framework}/${state}`;
      const result = resultMap.get(key);
      if (!result) return '   -   ';
      return result.passed ? '   ✓   ' : '   ✗   ';
    });

    const name = framework.padEnd(15);
    console.log(`│ ${name} │ ${cells[0]} │ ${cells[1]}       │`);
  }

  console.log('└─────────────────┴─────────┴───────────────┘');

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const rate = ((passed / total) * 100).toFixed(1);
  console.log(`\nResults: ${passed}/${total} passed (${rate}%)`);

  if (passed < total) {
    console.log('\nFailed scenarios:');
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  • ${result.scenario}`);
      if (result.error) {
        console.log(`    Error: ${result.error}`);
      } else if (result.checks) {
        for (const check of result.checks.filter((c) => !c.passed)) {
          console.log(`    - ${check.name}: ${check.message}`);
        }
      }
    }
  }
}

export function printJson(results: EvalResult[]): void {
  const output = {
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      passRate: results.filter((r) => r.passed).length / results.length,
    },
    results,
  };
  console.log(JSON.stringify(output, null, 2));
}
