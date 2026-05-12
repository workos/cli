/**
 * Recovery hints for structured CLI errors.
 *
 * Recovery metadata is consumed by coding agents through JSON stderr output.
 * Hints describe the deterministic next step the caller can take to fix the
 * failure: the exact command to run, whether host shell access is required,
 * and (optionally) related docs links.
 *
 * Keep hints conservative: only include `command` when the next action is
 * unambiguous and safe. When the correct next step depends on user intent,
 * provide `description` only.
 */

import type { InteractionMode } from './interaction-mode.js';
import { formatWorkOSCommand } from './command-invocation.js';

export interface RecoveryHint {
  /** Human-readable next step for both humans and agents. */
  description: string;
  /** Exact command to run, when deterministic. */
  command?: string;
  /** True when the command must run on the user's host shell, not in the current sandbox. */
  hostShellRequired?: boolean;
  /** Optional documentation URL. */
  docsUrl?: string;
  /** Optional markdown-capable documentation URL. Only set when route support is verified. */
  docsMarkdownUrl?: string;
}

export interface RecoveryHints {
  hints: RecoveryHint[];
}

/** Build mode-aware recovery hints for `auth_required` errors. */
export function authLoginRecovery(options: { mode: InteractionMode; env?: NodeJS.ProcessEnv }): RecoveryHints {
  const env = options.env ?? process.env;
  const loginCommand = formatWorkOSCommand('auth login', env);

  if (options.mode === 'ci') {
    return {
      hints: [
        {
          description: 'Set WORKOS_API_KEY in the CI environment.',
        },
        {
          description: 'Or refresh stored credentials before the CI run.',
          command: loginCommand,
          hostShellRequired: true,
        },
      ],
    };
  }

  if (options.mode === 'agent') {
    return {
      hints: [
        {
          description: "Authenticate on the user's host shell.",
          command: loginCommand,
          hostShellRequired: true,
        },
        {
          description: 'Or set WORKOS_API_KEY before invoking the CLI.',
        },
      ],
    };
  }

  return {
    hints: [
      {
        description: 'Authenticate via browser-based device login.',
        command: loginCommand,
      },
      {
        description: 'Or set WORKOS_API_KEY.',
      },
    ],
  };
}

/** Build a `confirmation_required` recovery hint, attaching a command only when the exact rerun is known. */
export function confirmationRecovery(command?: string): RecoveryHints {
  return {
    hints: [
      {
        description: 'Re-run with explicit confirmation.',
        ...(command && { command }),
      },
    ],
  };
}

/** Build a `missing_args` recovery hint, attaching a command only when it is directly runnable. */
export function missingArgsRecovery(command: string | undefined, description: string): RecoveryHints {
  return {
    hints: [
      {
        description,
        ...(command && { command }),
      },
    ],
  };
}
