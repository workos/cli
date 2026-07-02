import { runInstaller } from '../run.js';
import type { InstallerArgs } from '../run.js';
import clack from '../utils/clack.js';
import { exitWithError, isJsonMode } from '../utils/output.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';
import type { ArgumentsCamelCase } from 'yargs';
import { autoInstallSkills } from './install-skill.js';
import { maybeOfferMcpInstall } from '../lib/mcp-notice.js';

/**
 * Handle install command execution.
 */
export async function handleInstall(argv: ArgumentsCamelCase<InstallerArgs>): Promise<void> {
  const options = { ...argv };

  // CI mode validation
  if (options.ci) {
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
    const skillResult = await autoInstallSkills();
    if (skillResult && !isJsonMode()) {
      const skillWord = skillResult.skills.length === 1 ? 'skill' : 'skills';
      clack.log.info(
        `Installed ${skillResult.skills.length} WorkOS ${skillWord} for ${skillResult.agents.join(', ')}. Your coding agent now has up-to-date WorkOS guidance.`,
      );
    }

    // Offer to connect the user's coding agent to WorkOS via MCP. Self-gating
    // (human/TTY-only, decline-respecting) and best-effort — never fails install.
    await maybeOfferMcpInstall({ entryPoint: 'install-flow' });
  } catch (err) {
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
      clack.log.info(`Debug logs: ${logPath}`);
    }
    exitWithCode(ExitCode.GENERAL_ERROR);
  }
}
