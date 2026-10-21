import { appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { dirname, join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { prepareMessage } from './logging.js';
import { redactCredentials } from './redact.js';
import ui from './ui.js';
import { isJsonMode } from './output.js';

let debugEnabled = false;
let sessionLogPath: string | null = null;
/** A log file scoped to one async context, so concurrent runs (evals) don't share a path. */
const scopedLogPath = new AsyncLocalStorage<string>();

/** Run `fn` with all installer log lines written to `path` instead of the session log. */
export function runWithLogFile<T>(path: string, fn: () => T): T {
  return scopedLogPath.run(path, fn);
}

const LOG_DIR = join(homedir(), '.workos', 'logs');
const MAX_LOG_FILES = 10;

function ensureLogDir(): string {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  return LOG_DIR;
}

function getSafeTimestamp(): string {
  return new Date().toISOString().replace(/:/g, '-');
}

function rotateLogFiles(): void {
  try {
    const dir = ensureLogDir();
    const files = readdirSync(dir)
      .filter((f) => f.startsWith('workos-') && f.endsWith('.log'))
      .sort();

    const toDelete = files.slice(0, Math.max(0, files.length - MAX_LOG_FILES + 1));
    for (const file of toDelete) {
      try {
        unlinkSync(join(dir, file));
      } catch {
        // Ignore deletion failures
      }
    }
  } catch {
    // Ignore rotation failures
  }
}

export function initLogFile(): void {
  const scoped = scopedLogPath.getStore();
  if (scoped) {
    try {
      mkdirSync(dirname(scoped), { recursive: true });
      appendFileSync(scoped, `WorkOS AuthKit Installer Run: ${new Date().toISOString()}\n`);
    } catch {
      /* logging must never break the run */
    }
    return;
  }
  try {
    rotateLogFiles();
    const dir = ensureLogDir();
    const timestamp = getSafeTimestamp();
    sessionLogPath = join(dir, `workos-${timestamp}.log`);

    const header = `${'='.repeat(60)}\nWorkOS AuthKit Installer Run: ${new Date().toISOString()}\n${'='.repeat(60)}\n`;
    appendFileSync(sessionLogPath, header);
  } catch {
    sessionLogPath = null;
  }
}

export function getLogFilePath(): string | null {
  return scopedLogPath.getStore() ?? sessionLogPath;
}

function writeLog(level: 'INFO' | 'WARN' | 'ERROR', emoji: string, args: unknown[]): string {
  const redactedArgs = args.map((a) => (typeof a === 'object' && a !== null ? redactCredentials(a) : a));
  const msg = redactedArgs.map((a) => prepareMessage(a)).join(' ');

  // Write to console if debug enabled
  if (debugEnabled && !isJsonMode()) {
    const color = level === 'ERROR' ? chalk.red : level === 'WARN' ? chalk.yellow : chalk.dim;
    ui.log.info(color(`${emoji} ${msg}`));
  }

  // Write to log file
  const logPath = scopedLogPath.getStore() ?? sessionLogPath;
  if (logPath) {
    try {
      const timestamp = new Date().toISOString();
      appendFileSync(logPath, `[${timestamp}] ${emoji} ${level}: ${msg}\n`);
    } catch {
      // Ignore write failures
    }
  }

  return msg;
}

export function logInfo(...args: unknown[]): void {
  writeLog('INFO', 'ℹ️ ', args);
}

export function logWarn(...args: unknown[]): void {
  writeLog('WARN', '⚠️ ', args);
}

export function logVisibleWarn(...args: unknown[]): void {
  const msg = writeLog('WARN', '⚠️ ', args);
  if (!debugEnabled && !isJsonMode()) {
    console.error(chalk.yellow(`⚠️  ${msg}`));
  }
}

export function logError(...args: unknown[]): void {
  writeLog('ERROR', '❌', args);
}

export function debug(...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  const msg = args.map((a) => prepareMessage(a)).join(' ');
  ui.log.info(chalk.dim(msg));
}

export function isDebugEnabled(): boolean {
  return debugEnabled && !isJsonMode();
}

export function enableDebugLogs(): void {
  debugEnabled = true;
}
