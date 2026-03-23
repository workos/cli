/**
 * `workos env provision` — provision a new WorkOS environment.
 *
 * Free plan: provisions directly (no payment).
 * Production plan: MPP 402 → Stripe Checkout → poll → retry → credentials.
 *
 * Pattern: ./claim.ts (browser-open-and-poll), ../lib/unclaimed-env-provision.ts (credential persistence)
 */

import open from 'opn';
import clack from '../utils/clack.js';
import { getConfig, saveConfig } from '../lib/config-store.js';
import type { CliConfig } from '../lib/config-store.js';
import { logInfo, logError } from '../utils/debug.js';
import { isJsonMode, outputJson, exitWithError } from '../utils/output.js';
import {
  provisionFree,
  requestProduction,
  pollCheckoutStatus,
  provisionWithCredential,
  MppClientError,
  type MppProvisionResult,
} from '../lib/mpp-client.js';

function saveCredentials(result: MppProvisionResult): void {
  const config: CliConfig = getConfig() ?? { environments: {} };
  config.environments['unclaimed'] = {
    name: 'unclaimed',
    type: 'unclaimed',
    apiKey: result.apiKey,
    clientId: result.clientId,
    claimToken: result.claimToken,
  };
  config.activeEnvironment = 'unclaimed';
  saveConfig(config);
  logInfo('[provision] Credentials saved to config store');
}

function displayResult(result: MppProvisionResult): void {
  if (isJsonMode()) {
    outputJson({
      status: 'provisioned',
      client_id: result.clientId,
      api_key: result.apiKey,
      authkit_domain: result.authkitDomain,
      claim_token: result.claimToken,
      claim_url: result.claimUrl,
      plan: result.plan,
    });
    return;
  }

  clack.log.success(`Environment provisioned (${result.plan})`);
  clack.log.info(
    `  Client ID:      ${result.clientId}\n` +
      `  AuthKit Domain: ${result.authkitDomain}` +
      (result.claimUrl ? `\n  Claim URL:      ${result.claimUrl}` : ''),
  );
  clack.log.info('Run `workos env claim` to take ownership of this environment.');
}

export async function runProvision(plan: 'free' | 'production'): Promise<void> {
  if (plan === 'free') {
    try {
      const result = await provisionFree();
      saveCredentials(result);
      displayResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logError('[provision] Free provisioning failed:', message);
      exitWithError({ code: 'provision_failed', message: `Provisioning failed: ${message}` });
    }
    return;
  }

  // Production plan — MPP 402 → Checkout → retry
  try {
    const response = await requestProduction();

    if ('checkoutUrl' in response && response.status === 'payment_required') {
      // Payment required — handle checkout flow
      if (isJsonMode()) {
        outputJson({
          status: 'payment_required',
          checkout_url: response.checkoutUrl,
          session_id: response.sessionId,
        });
        return;
      }

      // TTY: open browser and poll
      clack.log.step('Payment required for production environment');
      clack.log.info(`Opening Stripe Checkout in your browser...\n\n  ${response.checkoutUrl}`);

      try {
        open(response.checkoutUrl, { wait: false });
      } catch {
        clack.log.info('Could not open browser — open the URL above manually.');
      }

      const spinner = clack.spinner();
      spinner.start('Waiting for payment...');

      try {
        const { credential } = await pollCheckoutStatus(
          response.sessionId,
          (status) => spinner.message(`Waiting for payment... (${status})`),
        );
        spinner.stop('Payment complete!');

        clack.log.step('Provisioning production environment...');
        const result = await provisionWithCredential(credential);
        saveCredentials(result);
        displayResult(result);
      } catch (error) {
        spinner.stop('Payment failed');
        if (error instanceof MppClientError) {
          exitWithError({ code: 'payment_failed', message: error.message });
        }
        throw error;
      }
      return;
    }

    // Direct success (shouldn't happen for production, but handle it)
    const result = response as MppProvisionResult;
    saveCredentials(result);
    displayResult(result);
  } catch (error) {
    if (error instanceof MppClientError) {
      logError('[provision] Production provisioning failed:', error.message);
      exitWithError({ code: 'provision_failed', message: error.message });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    logError('[provision] Unexpected error:', message);
    exitWithError({ code: 'provision_failed', message: `Provisioning failed: ${message}` });
  }
}
