import { runInstaller } from '../run.js';
import type { InstallerArgs } from '../run.js';
import ui from '../utils/ui.js';
import { exitWithError, isJsonMode } from '../utils/output.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';
import { isCiMode } from '../utils/interaction-mode.js';
import type { ArgumentsCamelCase } from 'yargs';
import { InstallDeclinedError } from '../lib/installer-errors.js';
import { maybeRunSetupAfter } from './setup.js';

/**
 * Handle install command execution.
 */
export async function handleInstall(argv: ArgumentsCamelCase<InstallerArgs>): Promise<void> {
  const options = { ...argv };

  // CI mode validation — trigger for the hidden --ci flag or WORKOS_MODE=ci.
  if (options.ci || isCiMode()) {
    if (!options.apiKey) {
      exitWithError({ code: 'missing_args', message: 'CI mode requires --api-key (WorkOS API key sk_xxx)' });
    }
    if (!options.clientId) {
      exitWithError({ code: 'missing_args', message: 'CI mode requires --client-id (WorkOS Client ID client_xxx)' });
    }
    if (!options.installDir) {
      exitWithError({
        code: 'missing_args',
        message: 'CI mode requires --install-dir (directory to install WorkOS AuthKit in)',
      });
    }
  }

  try {
    await runInstaller(options);

    // One consented moment offers skills + MCP together. Self-gating
    // (human/TTY-only, decline-respecting) and best-effort — never fails install.
    await maybeRunSetupAfter('install');
  } catch (err) {
    if (err instanceof InstallDeclinedError) {
      // The integration already printed actionable guidance; exit non-zero
      // so scripts don't proceed as if AuthKit were installed.
      if (isJsonMode()) {
        exitWithError({ code: err.code, message: err.message });
      }
      exitWithCode(ExitCode.GENERAL_ERROR);
    }

    const { getLogFilePath } = await import('../utils/debug.js');
    const logPath = getLogFilePath();

    if (isJsonMode()) {
      exitWithError({
        code: 'installer_error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    if (options.debug && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    if (logPath) {
      ui.log.info(`Debug logs: ${logPath}`);
    }
    exitWithCode(ExitCode.GENERAL_ERROR);
  }
}
