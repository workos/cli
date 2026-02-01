#!/usr/bin/env node
import { parseArgs, printHelp } from './cli.js';
import { runEvals } from './runner.js';
import { printMatrix, printJson } from './reporter.js';

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  try {
    const results = await runEvals(options);

    if (options.json) {
      printJson(results);
    } else {
      printMatrix(results);
    }

    process.exit(results.every((r) => r.passed) ? 0 : 1);
  } catch (error) {
    console.error('Eval failed:', error);
    process.exit(1);
  }
}

main();
