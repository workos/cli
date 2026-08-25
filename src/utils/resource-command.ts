/**
 * Shared flag and human-output helpers for the resource command surface
 * (`organization`, `user`, `role`, …). The printers are human-mode only —
 * callers branch on `isJsonMode()` before reaching them.
 */

import chalk from 'chalk';
import { exitWithError } from './output.js';

/** Map the CLI `--order asc|desc` flag onto the catalog's pagination enum. */
export function normalizeOrder(order: string | undefined): 'Asc' | 'Desc' | undefined {
  if (order === undefined) return undefined;
  const lower = order.toLowerCase();
  if (lower === 'asc') return 'Asc';
  if (lower === 'desc') return 'Desc';
  exitWithError({ code: 'invalid_argument', message: `Invalid --order "${order}". Allowed values: asc, desc.` });
}

/**
 * Print a detail (get) view: one bold `label: value` line per field, skipping
 * null/undefined/empty values, then the standing pointer at the full `--json`
 * record.
 */
export function printDetailFields(fields: Array<[string, unknown]>): void {
  for (const [label, value] of fields) {
    if (value === null || value === undefined || value === '') continue;
    console.log(`${chalk.bold(label)}: ${String(value)}`);
  }
  console.log(chalk.dim('Run with --json for the full record.'));
}

/** Print the cursor footer under a list view; silent when neither cursor exists. */
export function printPaginationFooter({ before, after }: { before?: string | null; after?: string | null }): void {
  if (before && after) {
    console.log(chalk.dim(`Before: ${before}  After: ${after}`));
  } else if (before) {
    console.log(chalk.dim(`Before: ${before}`));
  } else if (after) {
    console.log(chalk.dim(`After: ${after}`));
  }
}
