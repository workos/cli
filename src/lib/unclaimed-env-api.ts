/**
 * Unclaimed Environment Provisioning API Client
 *
 * Provisions unauthenticated unclaimed environments and generates claim nonces.
 * No authentication required for provisioning — claim tokens are used for
 * subsequent claim operations.
 */

import { logInfo, logError } from '../utils/debug.js';
import { resolveApiBaseUrl } from './api-key.js';

export interface UnclaimedEnvProvisionResult {
  clientId: string;
  apiKey: string;
  claimToken: string;
  authkitDomain: string;
}

export interface ClaimNonceResult {
  nonce: string;
  alreadyClaimed: false;
}

export interface AlreadyClaimedResult {
  alreadyClaimed: true;
}

export type ClaimNonceResponse = ClaimNonceResult | AlreadyClaimedResult;

export class UnclaimedEnvApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'UnclaimedEnvApiError';
  }
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Provision a new unclaimed environment. No authentication required.
 *
 * @returns UnclaimedEnvProvisionResult containing clientId, apiKey, claimToken, and authkitDomain
 * @throws UnclaimedEnvApiError on rate limit, network failure, timeout, or server error
 */
export async function provisionUnclaimedEnvironment(): Promise<UnclaimedEnvProvisionResult> {
  const url = `${resolveApiBaseUrl()}/x/one-shot-environments`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  logInfo('[unclaimed-env-api] Provisioning unclaimed environment:', url);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    logInfo('[unclaimed-env-api] Response status:', res.status);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logError('[unclaimed-env-api] Error response:', res.status, text);

      if (res.status === 429) {
        throw new UnclaimedEnvApiError('Rate limited. Please wait a moment and try again.', 429);
      }

      throw new UnclaimedEnvApiError(`Server error: ${res.status}`, res.status);
    }

    const data = (await res.json()) as {
      clientId?: string;
      apiKey?: string;
      claimToken?: string;
      authkitDomain?: string;
      client_id?: string;
      api_key?: string;
      claim_token?: string;
      authkit_domain?: string;
    };

    // Handle both camelCase and snake_case responses (API may respond in either format)
    const clientId = data.clientId ?? data.client_id;
    const apiKey = data.apiKey ?? data.api_key;
    const claimToken = data.claimToken ?? data.claim_token;
    const authkitDomain = data.authkitDomain ?? data.authkit_domain;

    if (!clientId || !apiKey || !claimToken || !authkitDomain) {
      logError('[unclaimed-env-api] Invalid response: missing required fields');
      throw new UnclaimedEnvApiError('Invalid response: missing required fields');
    }

    logInfo('[unclaimed-env-api] Unclaimed environment provisioned successfully');
    return { clientId, apiKey, claimToken, authkitDomain };
  } catch (error) {
    if (error instanceof UnclaimedEnvApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      logError('[unclaimed-env-api] Request timed out');
      throw new UnclaimedEnvApiError('Request timed out.');
    }
    logError('[unclaimed-env-api] Network error:', error instanceof Error ? error.message : 'Unknown');
    throw new UnclaimedEnvApiError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate a claim nonce from a claim token + client ID.
 * Returns { alreadyClaimed: true } if environment was already claimed.
 *
 * @param clientId - The client ID of the unclaimed environment
 * @param claimToken - The claim token from provisioning
 * @returns ClaimNonceResponse — either a nonce or already-claimed indicator
 * @throws UnclaimedEnvApiError on invalid token, not found, or server error
 */
export async function createClaimNonce(clientId: string, claimToken: string): Promise<ClaimNonceResponse> {
  const url = `${resolveApiBaseUrl()}/x/one-shot-environments/claim-nonces`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  logInfo('[unclaimed-env-api] Creating claim nonce:', url);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, claim_token: claimToken }),
      signal: controller.signal,
    });

    logInfo('[unclaimed-env-api] Response status:', res.status);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logError('[unclaimed-env-api] Error response:', res.status, text);

      if (res.status === 401) {
        throw new UnclaimedEnvApiError('Invalid claim token.', 401);
      }
      if (res.status === 404) {
        throw new UnclaimedEnvApiError('Environment not found.', 404);
      }
      if (res.status === 409) {
        logInfo('[unclaimed-env-api] Environment already claimed (409)');
        return { alreadyClaimed: true };
      }
      if (res.status === 429) {
        throw new UnclaimedEnvApiError('Rate limited. Please wait a moment and try again.', 429);
      }

      throw new UnclaimedEnvApiError(`Server error: ${res.status}`, res.status);
    }

    const data = (await res.json()) as {
      nonce?: string;
      alreadyClaimed?: boolean;
      already_claimed?: boolean;
    };

    const alreadyClaimed = data.alreadyClaimed ?? data.already_claimed;
    if (alreadyClaimed) {
      logInfo('[unclaimed-env-api] Environment already claimed');
      return { alreadyClaimed: true };
    }

    if (!data.nonce) {
      logError('[unclaimed-env-api] Invalid response: missing nonce');
      throw new UnclaimedEnvApiError('Invalid response: missing nonce');
    }

    logInfo('[unclaimed-env-api] Claim nonce created successfully');
    return { nonce: data.nonce, alreadyClaimed: false };
  } catch (error) {
    if (error instanceof UnclaimedEnvApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      logError('[unclaimed-env-api] Request timed out');
      throw new UnclaimedEnvApiError('Request timed out.');
    }
    logError('[unclaimed-env-api] Network error:', error instanceof Error ? error.message : 'Unknown');
    throw new UnclaimedEnvApiError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
