/**
 * MPP Client — calls the deployed MPP service for environment provisioning.
 *
 * Pattern: ./unclaimed-env-api.ts (raw fetch, custom error, camelCase mapping)
 */

import { logInfo, logError } from '../utils/debug.js';
import { sleep } from './helper-functions.js';

const MPP_SERVICE_URL = 'https://workos-mpp-service.nick-097.workers.dev';
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface MppProvisionResult {
  clientId: string;
  apiKey: string;
  authkitDomain: string;
  claimToken: string;
  claimUrl: string | null;
  plan: 'free' | 'production';
}

export interface MppPaymentRequired {
  status: 'payment_required';
  checkoutUrl: string;
  sessionId: string;
  challengeId: string;
}

export class MppClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'MppClientError';
  }
}

function mapProvisionResponse(data: Record<string, unknown>, plan: 'free' | 'production'): MppProvisionResult {
  const clientId = (data.client_id ?? data.clientId) as string | undefined;
  const apiKey = (data.api_key ?? data.apiKey) as string | undefined;
  const authkitDomain = (data.authkit_domain ?? data.authkitDomain) as string | undefined;
  const claimToken = (data.claim_token ?? data.claimToken) as string | undefined;
  const claimUrl = (data.claim_url ?? data.claimUrl ?? null) as string | null;

  if (!clientId || !apiKey || !authkitDomain || !claimToken) {
    throw new MppClientError('Invalid response: missing required fields');
  }

  return { clientId, apiKey, authkitDomain, claimToken, claimUrl, plan };
}

async function mppFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${MPP_SERVICE_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
    return res;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MppClientError('Request timed out.');
    }
    throw new MppClientError(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Provision a free environment (no payment). */
export async function provisionFree(): Promise<MppProvisionResult> {
  logInfo('[mpp-client] Provisioning free environment');

  const res = await mppFetch('/provision', { method: 'POST' });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logError('[mpp-client] Error response:', res.status, text);
    if (res.status === 429) throw new MppClientError('Rate limited. Please wait and try again.', 429);
    throw new MppClientError(`Server error: ${res.status}`, res.status);
  }

  const data = (await res.json()) as Record<string, unknown>;
  logInfo('[mpp-client] Free environment provisioned');
  return mapProvisionResponse(data, 'free');
}

/** Request production provisioning — returns payment info on 402. */
export async function requestProduction(): Promise<MppProvisionResult | MppPaymentRequired> {
  logInfo('[mpp-client] Requesting production provisioning');

  const res = await mppFetch('/provision/production', { method: 'POST' });

  if (res.status === 402) {
    const data = (await res.json()) as Record<string, unknown>;
    const checkoutUrl = data.checkout_url as string | undefined;
    const sessionId = data.session_id as string | undefined;
    const challengeId = (data.challenge_id ?? data.challengeId ?? '') as string;

    if (!checkoutUrl || !sessionId) {
      throw new MppClientError('MPP service did not return a checkout URL');
    }

    logInfo('[mpp-client] Payment required, checkout URL received');
    return { status: 'payment_required', checkoutUrl, sessionId, challengeId };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logError('[mpp-client] Error response:', res.status, text);
    if (res.status === 429) throw new MppClientError('Rate limited. Please wait and try again.', 429);
    throw new MppClientError(`Server error: ${res.status}`, res.status);
  }

  const data = (await res.json()) as Record<string, unknown>;
  logInfo('[mpp-client] Production environment provisioned directly');
  return mapProvisionResponse(data, 'production');
}

/** Poll checkout status until paid or timeout. */
export async function pollCheckoutStatus(
  sessionId: string,
  onPoll?: (status: string) => void,
): Promise<{ status: 'paid'; credential: string }> {
  logInfo('[mpp-client] Polling checkout status for session:', sessionId);
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const res = await mppFetch(`/checkout-status/${sessionId}`);

    if (res.status === 410) {
      throw new MppClientError('Payment was cancelled or session expired.', 410);
    }

    if (!res.ok) {
      logError('[mpp-client] Poll error:', res.status);
      onPoll?.('error');
      continue; // Transient errors — keep polling
    }

    const data = (await res.json()) as Record<string, unknown>;
    const status = data.status as string;

    onPoll?.(status);

    if (status === 'paid') {
      if (!data.credential) {
        throw new MppClientError('Paid response missing credential');
      }
      logInfo('[mpp-client] Payment complete');
      return { status: 'paid', credential: data.credential as string };
    }
  }

  throw new MppClientError('Payment timed out. Open the checkout URL to try again.');
}

/** Retry production provisioning with checkout credential. */
export async function provisionWithCredential(credential: string): Promise<MppProvisionResult> {
  logInfo('[mpp-client] Retrying provisioning with checkout credential');

  const res = await mppFetch('/provision/production', {
    method: 'POST',
    headers: { 'X-Checkout-Session': credential },
  });

  if (res.status === 402) {
    throw new MppClientError('Payment could not be verified. Try again.', 402);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logError('[mpp-client] Error response:', res.status, text);
    if (res.status === 429) throw new MppClientError('Rate limited. Please wait and try again.', 429);
    throw new MppClientError(`Server error: ${res.status}`, res.status);
  }

  const data = (await res.json()) as Record<string, unknown>;
  logInfo('[mpp-client] Production environment provisioned');
  return mapProvisionResponse(data, 'production');
}
