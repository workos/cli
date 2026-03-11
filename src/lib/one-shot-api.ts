/**
 * One-Shot Environment Provisioning API Client
 *
 * Provisions unauthenticated one-shot environments and generates claim nonces.
 * No authentication required for provisioning — claim tokens are used for
 * subsequent claim operations.
 */

import { logInfo, logError } from '../utils/debug.js';
import { getActiveEnvironment } from './config-store.js';

export interface OneShotProvisionResult {
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

export class OneShotApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'OneShotApiError';
  }
}

const DEFAULT_BASE_URL = 'https://api.workos.com';
const REQUEST_TIMEOUT_MS = 30_000;

function getBaseUrl(): string {
  const env = getActiveEnvironment();
  return env?.endpoint ?? DEFAULT_BASE_URL;
}

/**
 * Provision a new one-shot environment. No authentication required.
 *
 * @returns OneShotProvisionResult containing clientId, apiKey, claimToken, and authkitDomain
 * @throws OneShotApiError on rate limit, network failure, timeout, or server error
 */
export async function provisionOneShotEnvironment(): Promise<OneShotProvisionResult> {
  const url = `${getBaseUrl()}/x/one-shot-environments`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  logInfo('[one-shot-api] Provisioning one-shot environment:', url);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    logInfo('[one-shot-api] Response status:', res.status);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logError('[one-shot-api] Error response:', res.status, text);

      if (res.status === 429) {
        throw new OneShotApiError('Rate limited. Please wait a moment and try again.', 429);
      }

      throw new OneShotApiError(`Server error: ${res.status}`, res.status);
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

    // Handle both camelCase and snake_case responses
    const clientId = data.clientId || data.client_id;
    const apiKey = data.apiKey || data.api_key;
    const claimToken = data.claimToken || data.claim_token;
    const authkitDomain = data.authkitDomain || data.authkit_domain;

    if (!clientId || !apiKey || !claimToken || !authkitDomain) {
      logError('[one-shot-api] Invalid response: missing required fields');
      throw new OneShotApiError('Invalid response: missing required fields');
    }

    logInfo('[one-shot-api] One-shot environment provisioned successfully');
    return { clientId, apiKey, claimToken, authkitDomain };
  } catch (error) {
    if (error instanceof OneShotApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      logError('[one-shot-api] Request timed out');
      throw new OneShotApiError('Request timed out.');
    }
    logError('[one-shot-api] Network error:', error instanceof Error ? error.message : 'Unknown');
    throw new OneShotApiError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate a claim nonce from a claim token + client ID.
 * Returns { alreadyClaimed: true } if environment was already claimed.
 *
 * @param clientId - The client ID of the one-shot environment
 * @param claimToken - The claim token from provisioning
 * @returns ClaimNonceResponse — either a nonce or already-claimed indicator
 * @throws OneShotApiError on invalid token, not found, or server error
 */
export async function createClaimNonce(clientId: string, claimToken: string): Promise<ClaimNonceResponse> {
  const url = `${getBaseUrl()}/x/one-shot-environments/claim-nonces`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  logInfo('[one-shot-api] Creating claim nonce:', url);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, claim_token: claimToken }),
      signal: controller.signal,
    });

    logInfo('[one-shot-api] Response status:', res.status);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logError('[one-shot-api] Error response:', res.status, text);

      if (res.status === 401) {
        throw new OneShotApiError('Invalid claim token.', 401);
      }
      if (res.status === 404) {
        throw new OneShotApiError('Environment not found.', 404);
      }
      if (res.status === 429) {
        throw new OneShotApiError('Rate limited. Please wait a moment and try again.', 429);
      }

      throw new OneShotApiError(`Server error: ${res.status}`, res.status);
    }

    const data = (await res.json()) as {
      nonce?: string;
      alreadyClaimed?: boolean;
      already_claimed?: boolean;
    };

    const alreadyClaimed = data.alreadyClaimed ?? data.already_claimed;
    if (alreadyClaimed) {
      logInfo('[one-shot-api] Environment already claimed');
      return { alreadyClaimed: true };
    }

    if (!data.nonce) {
      logError('[one-shot-api] Invalid response: missing nonce');
      throw new OneShotApiError('Invalid response: missing nonce');
    }

    logInfo('[one-shot-api] Claim nonce created successfully');
    return { nonce: data.nonce, alreadyClaimed: false };
  } catch (error) {
    if (error instanceof OneShotApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      logError('[one-shot-api] Request timed out');
      throw new OneShotApiError('Request timed out.');
    }
    logError('[one-shot-api] Network error:', error instanceof Error ? error.message : 'Unknown');
    throw new OneShotApiError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate a random cookie password (32-char hex string).
 * Used as WORKOS_COOKIE_PASSWORD in .env.local for one-shot environments.
 */
export function generateCookiePassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
