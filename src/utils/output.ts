/**
 * Output mode system for non-TTY / JSON support.
 *
 * Resolves once at startup, drives all output formatting.
 * In JSON mode: structured JSON to stdout, structured errors to stderr.
 * In human mode: chalk-formatted output (existing behavior).
 */

import chalk from 'chalk';
import { formatTable, type TableColumn } from './table.js';

export type OutputMode = 'human' | 'json';

let currentMode: OutputMode = 'human';

/**
 * Resolve the output mode based on flags and environment.
 *
 * Priority:
 * 1. Explicit --json flag
 * 2. WORKOS_FORCE_TTY env var → human
 * 3. Non-TTY auto-detection → json
 * 4. Default → human
 */
export function resolveOutputMode(jsonFlag?: boolean): OutputMode {
  if (jsonFlag) return 'json';
  if (process.env.WORKOS_FORCE_TTY === '1' || process.env.WORKOS_FORCE_TTY === 'true') return 'human';
  if (process.env.WORKOS_NO_PROMPT === '1' || process.env.WORKOS_NO_PROMPT === 'true') return 'json';
  if (!process.stdout.isTTY) return 'json';
  return 'human';
}

export function setOutputMode(mode: OutputMode): void {
  currentMode = mode;
  if (mode === 'json') {
    chalk.level = 0;
  }
}

export function getOutputMode(): OutputMode {
  return currentMode;
}

export function isJsonMode(): boolean {
  return currentMode === 'json';
}

/** Write structured JSON to stdout (one line, no pretty-print). */
export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data));
}

/** Write a success result — chalk in human mode, JSON in json mode. */
export function outputSuccess(
  message: string,
  data?: object,
  options?: { warnings?: Array<{ code: string; message: string }> },
): void {
  if (currentMode === 'json') {
    const result: Record<string, unknown> = { status: 'ok', message };
    if (data) result.data = data;
    if (options?.warnings?.length) result.warnings = options.warnings;
    console.log(JSON.stringify(result));
  } else {
    console.log(chalk.green(message));
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
    if (options?.warnings?.length) {
      for (const w of options.warnings) {
        console.error(chalk.yellow(w.message));
      }
    }
  }
}

/** Write a structured error to stderr. */
export function outputError(error: { code: string; message: string; details?: unknown }): void {
  if (currentMode === 'json') {
    console.error(JSON.stringify({ error }));
  } else {
    console.error(chalk.red(error.message));
  }
}

/** Write tabular data — chalk table in human mode, JSON array in json mode. */
export function outputTable(columns: TableColumn[], rows: string[][], rawData?: unknown[]): void {
  if (currentMode === 'json') {
    if (rawData) {
      console.log(JSON.stringify(rawData));
    } else {
      const headers = columns.map((c) => c.header);
      const jsonRows = rows.map((row) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = row[i] ?? '';
        });
        return obj;
      });
      console.log(JSON.stringify(jsonRows));
    }
  } else {
    console.log(formatTable(columns, rows));
  }
}

/** Exit with a structured error. Writes error then exits with code 1. */
export function exitWithError(error: { code: string; message: string; details?: unknown }): never {
  outputError(error);
  process.exit(1);
}
