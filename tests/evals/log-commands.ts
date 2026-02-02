import fs from 'node:fs/promises';
import path from 'node:path';
import type { EvalLogFile } from './log-types.js';

const RESULTS_DIR = path.join(process.cwd(), 'tests', 'eval-results');

export async function listLogs(): Promise<void> {
  try {
    const files = await fs.readdir(RESULTS_DIR);
    const logFiles = files
      .filter((f) => f.startsWith('eval-run-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 10);

    if (logFiles.length === 0) {
      console.log('No eval log files found. Run `pnpm eval` first.');
      return;
    }

    console.log('Recent eval logs:\n');
    for (const file of logFiles) {
      const stat = await fs.stat(path.join(RESULTS_DIR, file));
      const size = Math.round(stat.size / 1024);
      console.log(`  ${file} (${size}KB)`);
    }
    console.log(`\nUse 'pnpm eval:show <filename>' to view details.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('No eval log files found. Run `pnpm eval` first.');
    } else {
      throw error;
    }
  }
}

export async function showLog(filename: string): Promise<void> {
  const filePath = path.join(RESULTS_DIR, filename);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const log: EvalLogFile = JSON.parse(content);

    console.log(`\n=== Eval Run: ${log.meta.timestamp} ===\n`);
    console.log(`Concurrency: ${log.meta.concurrency}`);
    console.log(`Duration: ${Math.round((log.meta.totalDuration ?? 0) / 1000)}s`);
    console.log(`Pass rate: ${log.summary.passRate}% (${log.summary.passed}/${log.summary.total})\n`);

    console.log('Scenarios:');
    for (const s of log.scenarios) {
      const icon = s.finalStatus === 'passed' ? '✓' : '✗';
      const attempts = s.attempts.length > 1 ? ` (${s.attempts.length} attempts)` : '';
      console.log(`  ${icon} ${s.scenario} - ${Math.round(s.totalDuration / 1000)}s${attempts}`);

      if (s.finalStatus === 'failed') {
        const lastAttempt = s.attempts[s.attempts.length - 1];
        if (lastAttempt.error) {
          console.log(`      Error: ${lastAttempt.error}`);
        }
        if (lastAttempt.checks) {
          const failed = lastAttempt.checks.filter((c) => !c.passed);
          for (const c of failed) {
            console.log(`      - ${c.name}: ${c.message}`);
          }
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`Log file not found: ${filename}`);
      console.error(`Use 'pnpm eval:logs' to list available files.`);
      process.exit(1);
    } else if (error instanceof SyntaxError) {
      console.error(`Invalid JSON in log file: ${filename}`);
      process.exit(1);
    } else {
      throw error;
    }
  }
}
