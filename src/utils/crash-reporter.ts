import { analytics } from './analytics.js';
import { CliExit } from './cli-exit.js';
import { homedir } from 'node:os';

// Hard ceiling the telemetry API enforces on every attribute value
// (z.string().max(4096) in llm-gateway/types/telemetry-event.ts). The final
// sanitized string — truncation marker included — MUST stay within this, or
// the whole crash event fails Zod validation server-side and is silently
// dropped. Reserve room for the marker so a truncated stack lands at exactly
// MAX_STACK_LENGTH rather than overshooting it.
const MAX_STACK_LENGTH = 4096;
const STACK_TRUNCATION_MARKER = '\n...[truncated]';
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
  // Collapse absolute paths to their leaf segment. POSIX and Windows separately —
  // Windows paths (C:\...\node_modules\) bypass the POSIX regex and would
  // otherwise leak full local filesystem paths into telemetry.
  sanitized = sanitized
    .replace(/\/[^\s:]+\/(node_modules|dist|src)\//g, '$1/')
    .replace(/[A-Za-z]:\\[^\s:]+\\(node_modules|dist|src)\\/g, '$1\\');
  sanitized = redactSecrets(sanitized);
  return sanitized.length > MAX_STACK_LENGTH
    ? sanitized.slice(0, MAX_STACK_LENGTH - STACK_TRUNCATION_MARKER.length) + STACK_TRUNCATION_MARKER
    : sanitized;
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
    // A CliExit that reaches here escaped the normal lifecycle (e.g. thrown
    // from a fire-and-forget async event listener like `child.on('error')` in
    // dev.ts). It is an intentional exit, NOT a crash — record no crash event,
    // just honor the requested code.
    if (error instanceof CliExit) {
      process.exit(error.exitCode);
    }
    reportCrashSync(error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    if (reason instanceof CliExit) {
      process.exit(reason.exitCode);
    }
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
