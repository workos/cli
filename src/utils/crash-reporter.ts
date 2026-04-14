import { analytics } from './analytics.js';
import { homedir } from 'node:os';

const MAX_STACK_LENGTH = 4096;
let isCrashing = false;

/**
 * Sanitize stack trace: strip absolute paths to relative, remove home dir.
 * Prevents leaking file system layout in telemetry events.
 */
export function sanitizeStack(stack: string | undefined): string {
  if (!stack) return '';
  const home = homedir();
  let sanitized = stack;
  sanitized = sanitized.replaceAll(home, '~');
  sanitized = sanitized.replace(/\/[^\s:]+\/(node_modules|dist|src)\//g, '$1/');
  return sanitized.length > MAX_STACK_LENGTH
    ? sanitized.slice(0, MAX_STACK_LENGTH) + '\n...[truncated]'
    : sanitized;
}

/**
 * Register global handlers for uncaughtException and unhandledRejection
 * that capture crash details before the process exits.
 *
 * Handlers are SYNCHRONOUS. Node does NOT await async uncaughtException handlers.
 * We queue the event synchronously; store-forward's process.on('exit') handler
 * persists it to disk. The next CLI invocation recovers and sends.
 */
export function installCrashReporter(): void {
  process.on('uncaughtException', (error) => {
    reportCrashSync(error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    reportCrashSync(error);
    process.exit(1);
  });
}

function reportCrashSync(error: Error): void {
  if (isCrashing) return;
  isCrashing = true;
  try {
    // Sanitize the stack before passing to analytics
    const sanitized = new Error(error.message);
    sanitized.name = error.name;
    sanitized.stack = sanitizeStack(error.stack);
    analytics.captureUnhandledCrash(sanitized);
  } catch {
    // Telemetry must never prevent exit
  }
}
