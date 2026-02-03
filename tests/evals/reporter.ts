import type { EvalResult } from './types.js';

// Short labels for display
const STATE_LABELS: Record<string, string> = {
  example: 'Base',
  'example-auth0': 'Auth0',
  'partial-install': 'Partial',
  'typescript-strict': 'Strict',
  'conflicting-middleware': 'Conflict',
  'conflicting-auth': 'Conflict',
};

export function printMatrix(results: EvalResult[]): void {
  const resultMap = new Map(results.map((r) => [r.scenario, r]));

  // Extract unique frameworks and states from results
  const frameworks = [...new Set(results.map((r) => r.scenario.split('/')[0]))];
  const states = [...new Set(results.map((r) => r.scenario.split('/')[1]))];

  // Sort states in logical order
  const stateOrder = ['example', 'example-auth0', 'partial-install', 'typescript-strict', 'conflicting-middleware', 'conflicting-auth'];
  states.sort((a, b) => stateOrder.indexOf(a) - stateOrder.indexOf(b));

  // Build dynamic table
  const colWidth = 8;
  const fwWidth = 15;

  // Header
  const headerCells = states.map((s) => (STATE_LABELS[s] || s).padStart(colWidth)).join('│');
  const divider = states.map(() => '─'.repeat(colWidth)).join('┼');

  console.log(`\n┌${'─'.repeat(fwWidth)}┬${states.map(() => '─'.repeat(colWidth)).join('┬')}┐`);
  console.log(`│${'Framework'.padEnd(fwWidth)}│${headerCells}│`);
  console.log(`├${'─'.repeat(fwWidth)}┼${divider}┤`);

  for (const framework of frameworks) {
    const cells = states.map((state) => {
      const key = `${framework}/${state}`;
      const result = resultMap.get(key);
      if (!result) return '-'.padStart(colWidth);
      return (result.passed ? '✓' : '✗').padStart(colWidth);
    });

    console.log(`│${framework.padEnd(fwWidth)}│${cells.join('│')}│`);
  }

  console.log(`└${'─'.repeat(fwWidth)}┴${states.map(() => '─'.repeat(colWidth)).join('┴')}┘`);

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
