/**
 * Standardized exit codes following gh CLI convention.
 *
 * 0 = Success
 * 1 = General error
 * 2 = Cancelled (e.g., Ctrl+C, user cancelled prompt)
 * 4 = Authentication required
 */

import { CliExit } from './cli-exit.js';
import { outputError, type StructuredError } from './output.js';
import { formatWorkOSCommand } from './command-invocation.js';
import { authLoginRecovery } from './recovery-hints.js';
import { getInteractionMode } from './interaction-mode.js';
import type { TerminationReason } from './telemetry-types.js';

export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  CANCELLED: 2,
  AUTH_REQUIRED: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

const ERROR_CODE_MAP: Record<string, { reason: TerminationReason; exit: ExitCodeValue }> = {
  auth_required: { reason: 'auth_required', exit: ExitCode.AUTH_REQUIRED },
  // resolveApiKey() emits `no_api_key` when no key is configured; semantically
  // an auth failure, so it must not fall through to `validation_error`.
  no_api_key: { reason: 'auth_required', exit: ExitCode.AUTH_REQUIRED },
  cancelled: { reason: 'cancelled', exit: ExitCode.CANCELLED },
};

export function resolveErrorCode(code: string): {
  reason: TerminationReason;
  exit: ExitCodeValue;
} {
  const mapped = ERROR_CODE_MAP[code];
  if (mapped) return mapped;
  if (code.startsWith('http_')) {
    return { reason: 'api_error', exit: ExitCode.GENERAL_ERROR };
  }
  return { reason: 'validation_error', exit: ExitCode.GENERAL_ERROR };
}

function reasonForExitCode(code: ExitCodeValue): TerminationReason {
  if (code === ExitCode.AUTH_REQUIRED) return 'auth_required';
  if (code === ExitCode.CANCELLED) return 'cancelled';
  if (code === ExitCode.SUCCESS) return 'success';
  return 'validation_error';
}

/** Exit with a specific code, optionally writing a structured error first. */
export function exitWithCode(code: ExitCodeValue, error?: StructuredError): never {
  if (error) {
    outputError(error);
  }
  throw new CliExit(code, {
    reason: reasonForExitCode(code),
    errorCode: error?.code,
  });
}

/**
 * Convenience: exit with code 4 and auth-required error.
 *
 * Recovery hints are inferred from interaction mode unless explicitly provided.
 */
export function exitWithAuthRequired(message?: string, options?: { recovery?: StructuredError['recovery'] }): never {
  const mode = getInteractionMode().mode;
  exitWithCode(ExitCode.AUTH_REQUIRED, {
    code: 'auth_required',
    message:
      message ??
      `Not authenticated. Run \`${formatWorkOSCommand('auth login')}\` in an interactive terminal, or set WORKOS_API_KEY.`,
    recovery: options?.recovery ?? authLoginRecovery({ mode }),
  });
}
