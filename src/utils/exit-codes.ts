/**
 * Standardized exit codes following gh CLI convention.
 *
 * 0 = Success
 * 1 = General error
 * 2 = Cancelled (e.g., Ctrl+C, user cancelled prompt)
 * 4 = Authentication required
 */

import { outputError } from './output.js';

export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  CANCELLED: 2,
  AUTH_REQUIRED: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** Exit with a specific code, optionally writing a structured error first. */
export function exitWithCode(code: ExitCodeValue, error?: { code: string; message: string }): never {
  if (error) {
    outputError(error);
  }
  process.exit(code);
}

/** Convenience: exit with code 4 and auth-required error. */
export function exitWithAuthRequired(message?: string): never {
  exitWithCode(ExitCode.AUTH_REQUIRED, {
    code: 'auth_required',
    message: message ?? 'Not authenticated. Run `workos login` in an interactive terminal, or set WORKOS_API_KEY.',
  });
}
