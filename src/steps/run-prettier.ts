import type { Integration } from '../lib/constants.js';
import { traceStep } from '../telemetry.js';
import { analytics } from '../utils/analytics.js';
import clack from '../utils/clack.js';
import { getPackageDotJson, getUncommittedOrUntrackedFiles, isInGitRepo } from '../utils/clack-utils.js';
import { hasPackageInstalled } from '../utils/package-json.js';
import type { InstallerOptions } from '../utils/types.js';
import { spawn } from 'node:child_process';
import { SPAWN_OPTS } from '../utils/platform.js';

export async function runPrettierStep({
  installDir,
  integration,
}: Pick<InstallerOptions, 'installDir'> & {
  integration: Integration;
}): Promise<void> {
  return traceStep('run-prettier', async () => {
    if (!isInGitRepo()) {
      // We only run formatting on changed files. If we're not in a git repo, we can't find
      // changed files. So let's early-return without showing any formatting-related messages.
      return;
    }

    const changedOrUntrackedFiles = getUncommittedOrUntrackedFiles().map((filename) => {
      return filename.startsWith('- ') ? filename.slice(2) : filename;
    });

    if (!changedOrUntrackedFiles.length) {
      return;
    }

    const packageJson = await getPackageDotJson({ installDir });
    const prettierInstalled = hasPackageInstalled('prettier', packageJson);

    analytics.setTag('prettier-installed', prettierInstalled);

    if (!prettierInstalled) {
      return;
    }

    const prettierSpinner = clack.spinner();
    prettierSpinner.start('Running Prettier on your files.');

    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('npx', ['prettier', '--ignore-unknown', '--write', ...changedOrUntrackedFiles], {
          stdio: 'ignore',
          ...SPAWN_OPTS,
        });
        proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`prettier exited ${code}`))));
        proc.on('error', reject);
      });
    } catch {
      prettierSpinner.stop('Prettier failed to run. You may want to format the changes manually.');
      return;
    }

    prettierSpinner.stop('Prettier has formatted your files.');

    analytics.capture('installer interaction', {
      action: 'ran prettier',
      integration,
    });
  });
}
