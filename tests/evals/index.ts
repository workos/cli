#!/usr/bin/env node
import { parseArgs, printHelp } from './cli.js';
import { runEvals } from './runner.js';
import { printMatrix, printJson } from './reporter.js';
import { loadRun } from './history.js';
import { listLogs, showLog } from './log-commands.js';
import { diffRuns, printDiff } from './commands/diff.js';
import { listHistory, pruneHistory } from './commands/history.js';

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  try {
    switch (options.command) {
      case 'history': {
        await listHistory(options.limit || 10);
        break;
      }

      case 'diff':
      case 'compare': {
        const [id1, id2] = options.compareIds!;
        const run1 = await loadRun(id1);
        const run2 = await loadRun(id2);
        const diff = diffRuns(run1, run2);
        printDiff(diff, id1, id2);
        break;
      }

      case 'prune': {
        await pruneHistory(options.pruneKeep || 10);
        break;
      }

      case 'logs': {
        await listLogs();
        break;
      }

      case 'show': {
        await showLog(options.logFile!);
        break;
      }

      case 'run':
      default: {
        const results = await runEvals({
          framework: options.framework,
          state: options.state,
          verbose: options.verbose,
          keep: options.keep,
          keepOnFail: options.keepOnFail,
          retry: options.retry,
          sequential: options.sequential,
          noDashboard: options.noDashboard,
          debug: options.debug,
          noFail: options.noFail,
          noCorrection: options.noCorrection,
          quality: options.quality,
        });

        if (options.json) {
          printJson(results);
        } else {
          printMatrix(results);
        }
      }
    }
  } catch (error) {
    console.error('Eval failed:', error);
    process.exit(1);
  }
}

main();
