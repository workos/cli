#!/usr/bin/env node
import { parseArgs, printHelp } from './cli.js';
import { runEvals } from './runner.js';
import { printMatrix, printJson } from './reporter.js';
import { listRuns, loadRun, compareRuns } from './history.js';

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  try {
    switch (options.command) {
      case 'history': {
        const runs = await listRuns();
        if (runs.length === 0) {
          console.log('No eval runs found. Run `pnpm eval` first.');
          break;
        }
        console.log('Recent eval runs:');
        for (const run of runs.slice(0, 10)) {
          const data = await loadRun(run.replace('.json', ''));
          console.log(`  ${run.replace('.json', '')} - ${data.summary.passed}/${data.summary.total} passed`);
        }
        break;
      }

      case 'compare': {
        const [id1, id2] = options.compareIds!;
        const run1 = await loadRun(id1);
        const run2 = await loadRun(id2);
        compareRuns(run1, run2);
        break;
      }

      case 'run':
      default: {
        const results = await runEvals({
          framework: options.framework,
          state: options.state,
          verbose: options.verbose,
          keepOnFail: options.keepOnFail,
          retry: options.retry,
        });

        if (options.json) {
          printJson(results);
        } else {
          printMatrix(results);
        }

        process.exit(results.every((r) => r.passed) ? 0 : 1);
      }
    }
  } catch (error) {
    console.error('Eval failed:', error);
    process.exit(1);
  }
}

main();
