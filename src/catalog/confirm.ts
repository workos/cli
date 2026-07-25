import chalk from 'chalk';
import { exitWithError, isJsonMode } from '../utils/output.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';
import { isCiMode, isPromptAllowed } from '../utils/interaction-mode.js';

/**
 * Destructive-confirmation gate for catalog-driven category commands.
 *
 * Mirrors the request-confirmation pattern in `src/commands/api/index.ts`
 * (the `MUTATING_METHODS` gate): a non-interactive caller must pass `--yes`,
 * a JSON-mode caller must pass `--yes` (so stdout stays machine-readable), and
 * an interactive caller is prompted via the `ui` facade. The api gate is entangled with
 * request-specific state (endpoint, method, body, recovery-command building),
 * so the shared behavior is mirrored here rather than extracted — see the
 * Phase 2 implementation notes.
 *
 * Exit-code contract (follows the `gh`-style convention in
 * `src/utils/exit-codes.ts`):
 * - Non-interactive + destructive + no `--yes` => exit 1, `confirmation_required`
 * - Non-interactive + `--yes`                  => proceed (resolves)
 * - Interactive, user cancels                  => exit 2 (CANCELLED)
 * - Interactive, user confirms                 => proceed (resolves)
 *
 * Note: exit 2 is reserved for active prompt cancellation only. A
 * non-interactive refusal is a general error (exit 1), NOT a cancellation.
 */
export interface ConfirmDestructiveOptions {
  /** Human-readable description of what will happen, e.g. "delete user usr_123". */
  action: string;
}

export async function confirmDestructive(
  argv: { yes?: boolean; json?: boolean },
  opts: ConfirmDestructiveOptions,
): Promise<void> {
  // Explicit consent always proceeds, regardless of interaction/output mode.
  if (argv.yes) return;

  // Non-interactive (agent/CI/non-TTY): there is no one to prompt. Refuse with a
  // general error so scripts get a stable, non-zero exit and a recoverable code.
  if (!isPromptAllowed()) {
    exitWithError({
      code: 'confirmation_required',
      message: isCiMode()
        ? `Destructive operations in CI mode require --yes. Refusing to ${opts.action}.`
        : `Destructive operations in agent mode require --yes. Refusing to ${opts.action}.`,
    });
  }

  // JSON output requested in an interactive terminal: prompting would pollute
  // machine-readable stdout, so require explicit consent instead.
  if (isJsonMode() || argv.json) {
    exitWithError({
      code: 'confirmation_required',
      message: `Destructive operations in JSON mode require --yes to keep stdout machine-readable.`,
    });
  }

  const ui = (await import('../utils/ui.js')).default;
  console.log(`\n${chalk.yellow('About to')} ${opts.action}`);
  const ok = await ui.confirm({ message: 'Proceed?' });
  if (!ok || ui.isCancel(ok)) {
    // Active cancellation of an interactive prompt => CANCELLED (exit 2).
    exitWithCode(ExitCode.CANCELLED);
  }
}

export interface RequireConfirmationFlagOptions {
  /** Human-readable description of what will happen, e.g. "change a member's role". */
  action: string;
}

/**
 * The `require-flag` ci_policy gate for non-destructive but sensitive mutations
 * (privilege or security-posture changes, or fan-out provisioning).
 *
 * Unlike {@link confirmDestructive}, this never prompts: an interactive human is
 * trusted to mean what they typed. Its only job is to stop a *non-interactive*
 * caller (agent/CI/non-TTY, or JSON output) from making the change without
 * explicit consent — the "broken CI loop" guard from the interview. A
 * non-interactive caller must pass `--yes`.
 *
 * Exit-code contract (matches {@link confirmDestructive} for the refusal path):
 * - Non-interactive + no `--yes` => exit 1, `confirmation_required`
 * - Non-interactive + `--yes`    => proceed (resolves)
 * - Interactive                  => proceed (resolves; no prompt)
 *
 * This is NOT the expensive-op load-capping engine (a later phase); it is the
 * cheap-load `require-flag` enforcement the first command category needs.
 */
export async function requireConfirmationFlag(
  argv: { yes?: boolean; json?: boolean },
  opts: RequireConfirmationFlagOptions,
): Promise<void> {
  // Explicit consent always proceeds.
  if (argv.yes) return;

  // Interactive humans are trusted — no prompt, no flag required.
  if (isPromptAllowed() && !isJsonMode() && !argv.json) return;

  // Non-interactive (or JSON output): refuse without explicit consent so a
  // scripted/agent run can't silently make a sensitive change.
  exitWithError({
    code: 'confirmation_required',
    message: isCiMode()
      ? `This change requires --yes in CI mode. Refusing to ${opts.action}.`
      : `This change requires --yes in non-interactive mode. Refusing to ${opts.action}.`,
  });
}
