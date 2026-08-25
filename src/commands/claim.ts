/**
 * `workos env claim` — claim an unclaimed environment.
 *
 * Reads claim token from active environment, generates a nonce via
 * createClaimNonce(), opens browser to dashboard claim URL, and polls
 * until the environment is claimed.
 */

import open from 'open';
import ui from '../utils/ui.js';
import { getActiveEnvironment, isUnclaimedEnvironment, markEnvironmentClaimed } from '../lib/config-store.js';
import { createClaimNonce, UnclaimedEnvApiError } from '../lib/unclaimed-env-api.js';
import { observeHostFailure } from '../lib/host-probe.js';
import { logInfo, logError } from '../utils/debug.js';
import { isJsonMode, outputJson, exitWithError } from '../utils/output.js';
import { isAgentMode, isCiMode } from '../utils/interaction-mode.js';
import { sleep } from '../lib/helper-functions.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import { networkRetryRecovery } from '../utils/recovery-hints.js';

const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 5_000; // 5 seconds
const MAX_CONSECUTIVE_FAILURES = 10;

/**
 * Run the claim flow.
 */
export async function runClaim(): Promise<void> {
  const activeEnv = getActiveEnvironment();

  if (!activeEnv || !isUnclaimedEnvironment(activeEnv)) {
    if (isJsonMode()) {
      outputJson({ status: 'no_unclaimed_environment', message: 'No unclaimed environment found. Nothing to claim.' });
    } else {
      ui.log.info('No unclaimed environment found. Nothing to claim.');
    }
    return;
  }

  // claimToken and clientId guaranteed present by UnclaimedEnvironmentConfig

  logInfo('[claim] Starting claim flow for environment:', activeEnv.name);

  try {
    ui.log.step('Generating claim link...');

    const result = await createClaimNonce(activeEnv.clientId, activeEnv.claimToken);

    if (result.alreadyClaimed) {
      markEnvironmentClaimed();
      if (isJsonMode()) {
        outputJson({ status: 'already_claimed', message: 'Environment already claimed!' });
      } else {
        ui.log.success('Environment already claimed!');
        ui.log.info(`Run \`${formatWorkOSCommand('auth login')}\` to connect your account.`);
      }
      return;
    }

    const claimUrl = `https://dashboard.workos.com/claim?nonce=${result.nonce}`;

    if (isJsonMode()) {
      outputJson({
        status: 'claim_url',
        claimUrl,
        nonce: result.nonce,
        permanent: true,
        note: 'Claiming permanently links this environment to your account and cannot be undone.',
      });
      return;
    }

    if (isCiMode()) {
      exitWithError({
        code: 'unsupported_in_ci',
        message: 'Environment claim requires opening the claim URL outside CI.',
        details: { claimUrl, nonce: result.nonce },
      });
    }

    ui.log.warn('Claiming permanently links this environment to your account and cannot be undone.');
    ui.log.info(`Open this URL to claim your environment:\n\n  ${claimUrl}`);

    try {
      await open(claimUrl, { wait: false });
      if (isAgentMode()) {
        ui.log.info('Browser launch attempted. If it did not open on the host, use the URL above.');
      } else {
        ui.log.info('Browser opened automatically');
      }
    } catch (openError) {
      observeHostFailure('browser-launch', openError, {
        operation: 'open',
        target: claimUrl,
        label: 'environment claim browser',
      });
      logError('[claim] Failed to open browser:', openError instanceof Error ? openError.message : String(openError));
      ui.log.info('Could not open browser — open the URL above manually.');
    }

    // Poll for claim completion
    const spinner = ui.spinner();
    spinner.start('Waiting for claim...');

    const startTime = Date.now();
    let consecutiveFailures = 0;

    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);
      try {
        const check = await createClaimNonce(activeEnv.clientId, activeEnv.claimToken);
        if (check.alreadyClaimed) {
          spinner.stop('Environment claimed!');
          markEnvironmentClaimed();
          ui.log.info(`Run \`${formatWorkOSCommand('auth login')}\` to connect your account.`);
          return;
        }
        consecutiveFailures = 0;
      } catch (pollError) {
        const statusCode = pollError instanceof UnclaimedEnvApiError ? pollError.statusCode : undefined;
        if (statusCode === 401) {
          // 401 means the server invalidated the claim token — this happens
          // when the environment is claimed. Safe to promote to sandbox.
          spinner.stop('Claim token is invalid or expired.');
          markEnvironmentClaimed();
          ui.log.warn(`Run \`${formatWorkOSCommand('auth login')}\` to set up your environment.`);
          return;
        }
        consecutiveFailures++;
        logError('[claim] Poll error:', pollError instanceof Error ? pollError.message : 'Unknown');
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          spinner.stop('Too many connection failures');
          ui.log.error(
            `Polling failed ${consecutiveFailures} times in a row. Check your network and try again.\n` +
              `You can also complete the claim at: ${claimUrl}`,
          );
          return;
        }
        if (consecutiveFailures >= 3) {
          spinner.message('Still waiting... (connection issues detected)');
        }
      }
    }

    spinner.stop('Claim timed out');
    ui.log.info(`Complete the claim in your browser, then run \`${formatWorkOSCommand('profile list')}\` to verify.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logError('[claim] Error:', message);
    exitWithError({
      code: 'claim_failed',
      message: `Could not claim this environment: ${message}`,
      recovery: networkRetryRecovery({ command: formatWorkOSCommand('profile claim') }),
    });
  }
}
