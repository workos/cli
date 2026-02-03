import { readdir, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import type { EvalRun } from '../history.js';

const RESULTS_DIR = join(process.cwd(), 'tests/eval-results');

export async function listHistory(limit: number = 10): Promise<void> {
  let files: string[];
  try {
    files = await readdir(RESULTS_DIR);
  } catch {
    console.log(chalk.yellow('No eval results found. Run `pnpm eval` first.'));
    return;
  }

  const runFiles = files
    .filter((f) => f.endsWith('.json') && f !== 'latest.json' && !f.startsWith('eval-run-'))
    .sort()
    .reverse()
    .slice(0, limit);

  if (runFiles.length === 0) {
    console.log(chalk.yellow('No eval results found. Run `pnpm eval` first.'));
    return;
  }

  console.log(chalk.bold('\nRecent Eval Runs:\n'));
  console.log('  ID                              Pass Rate   Scenarios   Avg Duration');
  console.log('  ' + '─'.repeat(68));

  for (const file of runFiles) {
    try {
      const content = await readFile(join(RESULTS_DIR, file), 'utf-8');
      const run: EvalRun = JSON.parse(content);

      const passRate = (run.summary.passRate * 100).toFixed(0) + '%';
      const scenarios = `${run.summary.passed}/${run.summary.total}`;
      const avgDuration =
        run.results.length > 0
          ? Math.round(run.results.reduce((s, r) => s + r.duration, 0) / run.results.length / 1000) +
            's'
          : 'N/A';

      const color = run.summary.passRate >= 0.9 ? chalk.green : chalk.red;
      const id = run.id.padEnd(32);

      console.log(
        `  ${id}  ${color(passRate.padEnd(10))} ${scenarios.padEnd(11)} ${avgDuration}`,
      );
    } catch {
      const id = file.replace('.json', '').padEnd(32);
      console.log(`  ${id}  ${chalk.gray('(unable to read)')}`);
    }
  }

  const totalRuns = files.filter((f) => f.endsWith('.json') && f !== 'latest.json' && !f.startsWith('eval-run-')).length;
  console.log(`\n  Showing ${runFiles.length} of ${totalRuns} runs. Use --limit=N for more.`);
}

export async function pruneHistory(keep: number = 10): Promise<void> {
  let files: string[];
  try {
    files = await readdir(RESULTS_DIR);
  } catch {
    console.log('No results directory found.');
    return;
  }

  const runFiles = files
    .filter((f) => f.endsWith('.json') && f !== 'latest.json' && !f.startsWith('eval-run-'))
    .sort()
    .reverse();

  const toDelete = runFiles.slice(keep);

  if (toDelete.length === 0) {
    console.log(`No runs to prune. Keeping all ${runFiles.length} runs.`);
    return;
  }

  console.log(`Pruning ${toDelete.length} old runs, keeping ${keep} most recent...`);

  for (const file of toDelete) {
    await unlink(join(RESULTS_DIR, file));
    console.log(chalk.gray(`  Deleted: ${file}`));
  }

  console.log(chalk.green(`Done. ${keep} runs remaining.`));
}
