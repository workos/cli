/**
 * Device Authorization Flow (OAuth 2.0 RFC 8628)
 * Reusable module for browser-based authentication from CLI apps.
 */

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
  onSlowDown?: (newInterval: number) => void;
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

export class DeviceAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceAuthError';
  }
}

const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'staging-environment:credentials:read'];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

export async function requestDeviceCode(options: DeviceAuthOptions): Promise<DeviceAuthResponse> {
  const scopes = options.scopes ?? DEFAULT_SCOPES;

  const res = await fetch(`${options.authkitDomain}/oauth2/device_authorization`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: options.clientId,
      scope: scopes.join(' '),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new DeviceAuthError(`Device authorization failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<DeviceAuthResponse>;
}

export async function pollForToken(
  deviceCode: string,
  options: DeviceAuthOptions & { interval: number }
): Promise<DeviceAuthResult> {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const startTime = Date.now();
  let pollInterval = options.interval * 1000;

  while (Date.now() - startTime < timeoutMs) {
    await sleep(pollInterval);
    options.onPoll?.();

    const res = await fetch(`${options.authkitDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: options.clientId,
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as TokenResponse;
      return parseTokenResponse(data);
    }

    const error = (await res.json()) as { error: string };

    if (error.error === 'authorization_pending') {
      continue;
    }

    if (error.error === 'slow_down') {
      pollInterval += 5000;
      options.onSlowDown?.(pollInterval);
      continue;
    }

    throw new DeviceAuthError(`Token error: ${error.error}`);
  }

  throw new DeviceAuthError('Authentication timed out after 5 minutes');
}

function parseTokenResponse(data: TokenResponse): DeviceAuthResult {
  const idPayload = parseJwt(data.id_token);
  const accessPayload = parseJwt(data.access_token);

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    expiresAt: accessPayload?.exp ? (accessPayload.exp as number) * 1000 : Date.now() + 15 * 60 * 1000,
    userId: String(idPayload?.sub ?? 'unknown'),
    email: idPayload?.email as string | undefined,
  };
}

export async function runDeviceAuthFlow(options: DeviceAuthOptions): Promise<DeviceAuthResult> {
  const deviceAuth = await requestDeviceCode(options);

  // Open browser (fire and forget)
  import('opn').then(({ default: open }) => {
    open(deviceAuth.verification_uri_complete).catch(() => {});
  });

  return pollForToken(deviceAuth.device_code, {
    ...options,
    interval: deviceAuth.interval,
  });
}

/**
 * Convenience function for use with events emitter.
 * Returns the device auth response for displaying to user before polling.
 */
export async function startDeviceAuth(options: DeviceAuthOptions): Promise<{
  deviceAuth: DeviceAuthResponse;
  poll: () => Promise<DeviceAuthResult>;
}> {
  const deviceAuth = await requestDeviceCode(options);

  return {
    deviceAuth,
    poll: () =>
      pollForToken(deviceAuth.device_code, {
        ...options,
        interval: deviceAuth.interval,
      }),
  };
}
