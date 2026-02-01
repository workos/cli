#!/usr/bin/env node
import { runEvals } from './runner.js';

async function main() {
  const args = process.argv.slice(2);

  // Parse basic flags (expand in Phase 2)
  const options = {
    framework: args.find((a) => a.startsWith('--framework='))?.split('=')[1],
    verbose: args.includes('--verbose'),
  };

  try {
    const results = await runEvals(options);

    // Print summary
    const passed = results.filter((r) => r.passed).length;
    console.log(`\n${passed}/${results.length} scenarios passed`);

    // Exit code
    process.exit(results.every((r) => r.passed) ? 0 : 1);
  } catch (error) {
    console.error('Eval failed:', error);
    process.exit(1);
  }
}

main();
