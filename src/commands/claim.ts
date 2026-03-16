/**
 * `workos env claim` — claim an unclaimed environment.
 *
 * Reads claim token from active environment, generates a nonce via
 * createClaimNonce(), opens browser to dashboard claim URL, and polls
 * until the environment is claimed.
 */

import open from 'opn';
import clack from '../utils/clack.js';
import { getActiveEnvironment, isUnclaimedEnvironment, markEnvironmentClaimed } from '../lib/config-store.js';
import { createClaimNonce, UnclaimedEnvApiError } from '../lib/unclaimed-env-api.js';
import { logInfo, logError } from '../utils/debug.js';
import { isJsonMode, outputJson, exitWithError } from '../utils/output.js';
import { sleep } from '../lib/helper-functions.js';

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
      clack.log.info('No unclaimed environment found. Nothing to claim.');
    }
    return;
  }

  // claimToken and clientId guaranteed present by UnclaimedEnvironmentConfig

  logInfo('[claim] Starting claim flow for environment:', activeEnv.name);

  try {
    clack.log.step('Generating claim link...');

    const result = await createClaimNonce(activeEnv.clientId, activeEnv.claimToken);

    if (result.alreadyClaimed) {
      markEnvironmentClaimed();
      if (isJsonMode()) {
        outputJson({ status: 'already_claimed', message: 'Environment already claimed!' });
      } else {
        clack.log.success('Environment already claimed!');
        clack.log.info('Run `workos auth login` to connect your account.');
      }
      return;
    }

    const claimUrl = `https://dashboard.workos.com/claim?nonce=${result.nonce}`;

    if (isJsonMode()) {
      outputJson({ status: 'claim_url', claimUrl, nonce: result.nonce });
      return;
    }

    clack.log.info(`Open this URL to claim your environment:\n\n  ${claimUrl}`);

    try {
      open(claimUrl, { wait: false });
      clack.log.info('Browser opened automatically');
    } catch (openError) {
      logError('[claim] Failed to open browser:', openError instanceof Error ? openError.message : String(openError));
      clack.log.info('Could not open browser — open the URL above manually.');
    }

    // Poll for claim completion
    const spinner = clack.spinner();
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
          clack.log.info('Run `workos auth login` to connect your account.');
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
          clack.log.warn('Run `workos auth login` to set up your environment.');
          return;
        }
        consecutiveFailures++;
        logError('[claim] Poll error:', pollError instanceof Error ? pollError.message : 'Unknown');
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          spinner.stop('Too many connection failures');
          clack.log.error(
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
    clack.log.info('Complete the claim in your browser, then run `workos env list` to verify.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logError('[claim] Error:', message);
    exitWithError({ code: 'claim_failed', message: `Claim failed: ${message}` });
  }
}
