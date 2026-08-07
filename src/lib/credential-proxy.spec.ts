import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../utils/debug.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../utils/analytics.js', () => ({
  analytics: { capture: vi.fn() },
}));

vi.mock('./credentials.js', () => ({
  getCredentials: vi.fn(() => ({
    accessToken: 'access-token',
    expiresAt: Date.now() + 3_600_000,
    userId: 'user_x',
  })),
  updateTokens: vi.fn(),
}));

vi.mock('./token-refresh-client.js', () => ({
  refreshAccessToken: vi.fn(),
}));

vi.mock('./host-probe.js', () => ({
  observeHostFailure: vi.fn(),
}));

import { startCredentialProxy, startClaimTokenProxy, type CredentialProxyHandle } from './credential-proxy.js';

/**
 * The socket timeout is the only knob standing between a long agent turn and a
 * spurious 504. The gateway aggregates streams internally, so a non-streaming
 * client can sit silent for minutes; 120s used to kill exactly those requests.
 * Both factories are covered because the unclaimed-environment install path
 * goes through the claim-token proxy, not the credential proxy.
 */
const EXPECTED_TIMEOUT_MS = 600_000;

/** A throwaway upstream so the proxied request completes instead of hanging. */
async function startUpstream(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('credential proxy upstream timeout', () => {
  let capturedOptions: http.RequestOptions[];
  let upstream: Awaited<ReturnType<typeof startUpstream>>;
  let proxy: CredentialProxyHandle | null = null;

  beforeEach(async () => {
    capturedOptions = [];
    upstream = await startUpstream();

    // Capture what the proxy asks the transport for, then let the real request
    // run so the response pipeline (and the test's fetch) actually completes.
    const realRequest = http.request;
    vi.spyOn(http, 'request').mockImplementation(((...args: Parameters<typeof http.request>) => {
      capturedOptions.push(args[0] as http.RequestOptions);
      return realRequest(...args);
    }) as typeof http.request);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await proxy?.stop();
    proxy = null;
    await upstream.close();
  });

  it('startCredentialProxy forwards with a 600s socket timeout', async () => {
    proxy = await startCredentialProxy({ upstreamUrl: upstream.url });

    const res = await fetch(`${proxy.url}/v1/messages`, { method: 'POST', body: '{}' });

    expect(res.status).toBe(200);
    expect(capturedOptions).toHaveLength(1);
    expect(capturedOptions[0].timeout).toBe(EXPECTED_TIMEOUT_MS);
  });

  it('startClaimTokenProxy forwards with a 600s socket timeout', async () => {
    proxy = await startClaimTokenProxy({
      upstreamUrl: upstream.url,
      claimToken: 'claim_xyz',
      clientId: 'client_x',
    });

    const res = await fetch(`${proxy.url}/v1/messages`, { method: 'POST', body: '{}' });

    expect(res.status).toBe(200);
    expect(capturedOptions).toHaveLength(1);
    expect(capturedOptions[0].timeout).toBe(EXPECTED_TIMEOUT_MS);
  });
});
