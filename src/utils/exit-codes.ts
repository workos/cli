/**
 * Standardized exit codes following gh CLI convention.
 *
 * 0 = Success
 * 1 = General error
 * 2 = Cancelled (e.g., Ctrl+C, user cancelled prompt)
 * 4 = Authentication required
 */

import { outputError, type StructuredError } from './output.js';
import { formatWorkOSCommand } from './command-invocation.js';
import { authLoginRecovery } from './recovery-hints.js';
import { getInteractionMode } from './interaction-mode.js';

export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  CANCELLED: 2,
  AUTH_REQUIRED: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** Exit with a specific code, optionally writing a structured error first. */
export function exitWithCode(code: ExitCodeValue, error?: StructuredError): never {
  if (error) {
    outputError(error);
  }
  process.exit(code);
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
