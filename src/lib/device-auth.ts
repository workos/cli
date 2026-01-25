/**
 * Device Authorization Flow
 *
 * Implements OAuth 2.0 Device Authorization Grant (RFC 8628) for CLI authentication.
 * Extracted from login.ts for reuse in wizard credential gathering.
 */

import { logInfo, logError } from '../utils/debug.js';

export interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceAuthOptions {
  clientId: string;
  authkitDomain: string;
  scopes?: string[];
  timeoutMs?: number;
  onPoll?: () => void;
  onSlowDown?: (newIntervalMs: number) => void;
}

export interface DeviceAuthResult {
  accessToken: string;
  idToken: string;
  expiresAt: number;
  userId: string;
  email?: string;
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface AuthErrorResponse {
  error: string;
}

export class DeviceAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceAuthError';
  }
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_SCOPES = ['openid', 'email', 'staging-environment:credentials:read'];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse JWT payload
 */
function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

/**
 * Extract expiry time from JWT token
 */
function getJwtExpiry(token: string): number | null {
  const payload = parseJwt(token);
  if (!payload || typeof payload.exp !== 'number') return null;
  return payload.exp * 1000;
}

/**
 * Request a device code from the OAuth authorization server.
 * Returns the device code, user code, and verification URIs.
 */
export async function requestDeviceCode(options: DeviceAuthOptions): Promise<DeviceAuthResponse> {
  const scopes = options.scopes ?? DEFAULT_SCOPES;
  const url = `${options.authkitDomain}/oauth2/device_authorization`;

  logInfo('[device-auth] Requesting device code from:', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: options.clientId,
      scope: scopes.join(' '),
    }),
  });

  logInfo('[device-auth] Device code response status:', res.status);
  if (!res.ok) {
    const text = await res.text();
    logError('[device-auth] Device authorization failed:', res.status, text);
    throw new DeviceAuthError(`Device authorization failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as DeviceAuthResponse;
  logInfo('[device-auth] Device code received, user_code:', data.user_code);
  return data;
}

/**
 * Poll for token after user has authorized in the browser.
 * Handles authorization_pending and slow_down responses per RFC 8628.
 */
export async function pollForToken(
  deviceCode: string,
  options: DeviceAuthOptions & { interval: number },
): Promise<DeviceAuthResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();
  let pollInterval = options.interval * 1000;
  const tokenUrl = `${options.authkitDomain}/oauth2/token`;

  logInfo('[device-auth] Starting token polling, timeout:', timeoutMs);
  while (Date.now() - startTime < timeoutMs) {
    await sleep(pollInterval);
    options.onPoll?.();

    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
          client_id: options.clientId,
        }),
      });
    } catch (err) {
      logInfo('[device-auth] Token poll network error, retrying');
      continue;
    }

    let data;
    try {
      data = await res.json();
    } catch {
      logError('[device-auth] Invalid JSON response from auth server');
      throw new DeviceAuthError('Invalid response from auth server');
    }

    logInfo('[device-auth] Token poll response:', res.status, (data as AuthErrorResponse)?.error ?? 'success');
    if (res.ok) {
      logInfo('[device-auth] Token received successfully');
      return parseTokenResponse(data as TokenResponse);
    }

    const errorData = data as AuthErrorResponse;

    if (errorData.error === 'authorization_pending') {
      continue;
    }

    if (errorData.error === 'slow_down') {
      pollInterval += 5000;
      logInfo('[device-auth] Slowing down, new interval:', pollInterval);
      options.onSlowDown?.(pollInterval);
      continue;
    }

    logError('[device-auth] Token error:', errorData.error);
    throw new DeviceAuthError(`Token error: ${errorData.error}`);
  }

  logError('[device-auth] Authentication timed out');
  throw new DeviceAuthError('Authentication timed out after 5 minutes');
}

function parseTokenResponse(data: TokenResponse): DeviceAuthResult {
  const idPayload = parseJwt(data.id_token);
  const jwtExpiry = getJwtExpiry(data.access_token);

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    expiresAt: jwtExpiry ?? (data.expires_in ? Date.now() + data.expires_in * 1000 : Date.now() + 15 * 60 * 1000),
    userId: String(idPayload?.sub ?? 'unknown'),
    email: idPayload?.email as string | undefined,
  };
}
