/**
 * `workos claim` — claim an unclaimed one-shot environment.
 *
 * Reads claim token from active environment, generates a nonce via
 * createClaimNonce(), opens browser to dashboard claim URL, and polls
 * until the environment is claimed.
 */

import open from 'opn';
import clack from '../utils/clack.js';
import { getConfig, saveConfig, getActiveEnvironment, isUnclaimedEnvironment } from '../lib/config-store.js';
import { createClaimNonce } from '../lib/one-shot-api.js';
import { logInfo, logError } from '../utils/debug.js';
import { isJsonMode, outputJson } from '../utils/output.js';

const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 5_000; // 5 seconds

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mark the active unclaimed environment as claimed.
 * Updates type to 'sandbox' and removes the claim token.
 */
export function markEnvironmentClaimed(): void {
  const config = getConfig();
  if (!config?.activeEnvironment) return;
  const env = config.environments[config.activeEnvironment];
  if (env) {
    env.type = 'sandbox';
    delete env.claimToken;
    saveConfig(config);
  }
}

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

  if (!activeEnv.claimToken || !activeEnv.clientId) {
    if (isJsonMode()) {
      outputJson({ status: 'error', message: 'Missing claim token or client ID.' });
    } else {
      clack.log.error('Missing claim token or client ID.');
    }
    return;
  }

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
      await open(claimUrl);
      clack.log.info('Browser opened automatically');
    } catch {
      // User can open manually
    }

    // Poll for claim completion
    const spinner = clack.spinner();
    spinner.start('Waiting for claim...');

    const startTime = Date.now();

    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);
      try {
        const check = await createClaimNonce(activeEnv.clientId, activeEnv.claimToken);
        if (check.alreadyClaimed) {
          spinner.stop('Environment claimed!');
          markEnvironmentClaimed();
          return;
        }
      } catch (pollError) {
        logError('[claim] Poll error:', pollError instanceof Error ? pollError.message : 'Unknown');
        // Continue polling — transient errors shouldn't stop the flow
      }
    }

    spinner.stop('Claim timed out');
    clack.log.info('Complete the claim in your browser, then run `workos env list` to verify.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logError('[claim] Error:', message);

    if (isJsonMode()) {
      outputJson({ status: 'error', message });
    } else {
      clack.log.error(`Claim failed: ${message}`);
      clack.log.info('Try again or claim via the WorkOS dashboard.');
    }
  }
}
