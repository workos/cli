import { analytics } from './analytics.js';
import { homedir } from 'node:os';

const MAX_STACK_LENGTH = 4096;
const MAX_MESSAGE_LENGTH = 1024;
const HOME = homedir();
let isCrashing = false;

/**
 * Redact known credential patterns (Bearer tokens, sk_test_/sk_live_ keys,
 * raw JWTs). Shared by sanitizeStack and sanitizeMessage because Node echoes
 * `.message` into the leading `Error.stack` line, so secrets in messages also
 * surface in stacks.
 */
function redactSecrets(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer <redacted>')
    .replace(/\bsk_(test|live)_[A-Za-z0-9]+/g, 'sk_<redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt-redacted>');
}

/** Sanitize stack trace for telemetry: homedir, absolute-path collapse, secrets, truncation. */
export function sanitizeStack(stack: string | undefined): string {
  if (!stack) return '';
  let sanitized = stack.replaceAll(HOME, '~');
  sanitized = sanitized.replace(/\/[^\s:]+\/(node_modules|dist|src)\//g, '$1/');
  sanitized = redactSecrets(sanitized);
  return sanitized.length > MAX_STACK_LENGTH ? sanitized.slice(0, MAX_STACK_LENGTH) + '\n...[truncated]' : sanitized;
}

/** Sanitize an error message for telemetry (homedir, secrets, truncation). */
export function sanitizeMessage(msg: string | undefined): string {
  if (!msg) return '';
  const sanitized = redactSecrets(msg.replaceAll(HOME, '~'));
  return sanitized.length > MAX_MESSAGE_LENGTH ? sanitized.slice(0, MAX_MESSAGE_LENGTH) + '...[truncated]' : sanitized;
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
    // captureUnhandledCrash sanitizes both message and stack at the analytics boundary.
    analytics.captureUnhandledCrash(error);
  } catch {
    // Telemetry must never prevent exit
  }
}
