/**
 * Lightweight HTTP proxy that injects credentials from file into requests.
 * Includes lazy token refresh - refreshes proactively when token is expiring soon.
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { logInfo, logError, logWarn } from '../utils/debug.js';
import { getCredentials, updateTokens, type Credentials } from './credentials.js';
import { analytics } from '../utils/analytics.js';
import { refreshAccessToken } from './token-refresh-client.js';

export interface RefreshConfig {
  /** AuthKit domain for refresh endpoint */
  authkitDomain: string;
  /** OAuth client ID */
  clientId: string;
  /** Threshold in ms - refresh when token expires within this window (default: 60000 = 1 min) */
  refreshThresholdMs?: number;
  /** Callback when refresh succeeds */
  onRefreshSuccess?: () => void;
  /** Callback when refresh fails permanently (token expired, invalid_grant) */
  onRefreshExpired?: () => void;
}

export interface CredentialProxyOptions {
  /** Upstream URL to forward requests to */
  upstreamUrl: string;
  /** Optional: specific port to bind (default: random) */
  port?: number;
  /** Optional: refresh configuration for lazy token refresh */
  refresh?: RefreshConfig;
}

export interface CredentialProxyHandle {
  /** Port the proxy is listening on */
  port: number;
  /** Full URL for the proxy (e.g., http://localhost:54321) */
  url: string;
  /** Stop the proxy server */
  stop: () => Promise<void>;
}

// Module-level state for lazy refresh
let refreshPromise: Promise<void> | null = null;
let refreshConfig: RefreshConfig | null = null;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Check if token needs refresh (expires within threshold).
 */
function tokenNeedsRefresh(expiresAt: number, thresholdMs: number): boolean {
  return Date.now() + thresholdMs >= expiresAt;
}

/**
 * Perform token refresh, updating credentials file.
 * Returns true if refresh succeeded.
 */
async function doRefresh(): Promise<boolean> {
  if (!refreshConfig) {
    logError('[credential-proxy] No refresh config available');
    return false;
  }

  const { authkitDomain, clientId, onRefreshSuccess, onRefreshExpired } = refreshConfig;
  const startTime = Date.now();

  logInfo('[credential-proxy] Starting token refresh...');

  analytics.capture('installer.token.refresh', {
    action: 'refresh_attempt',
    trigger: 'lazy',
  });

  const result = await refreshAccessToken(authkitDomain, clientId);

  if (result.success && result.accessToken && result.expiresAt) {
    // Update credentials file atomically
    updateTokens(result.accessToken, result.expiresAt, result.refreshToken);

    consecutiveFailures = 0;
    const durationMs = Date.now() - startTime;

    logInfo(
      `[credential-proxy] Token refreshed in ${durationMs}ms, expires: ${new Date(result.expiresAt).toISOString()}`,
    );

    analytics.capture('installer.token.refresh', {
      action: 'refresh_success',
      duration_ms: durationMs,
      token_rotated: !!result.refreshToken,
    });

    onRefreshSuccess?.();
    return true;
  }

  consecutiveFailures++;

  logError(`[credential-proxy] Refresh failed: ${result.error}`);

  analytics.capture('installer.token.refresh', {
    action: 'refresh_failure',
    error_type: result.errorType || 'unknown',
    error_message: result.error || 'Unknown error',
    consecutive_failures: consecutiveFailures,
  });

  // Handle permanent failure
  if (result.errorType === 'invalid_grant' || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    logError('[credential-proxy] Refresh token expired or too many failures');
    onRefreshExpired?.();
  }

  return false;
}

/**
 * Ensure we have valid credentials, refreshing if needed.
 * Uses a promise-based lock to prevent concurrent refreshes.
 *
 * @returns Credentials to use for request, or null if unavailable
 */
async function ensureValidCredentials(thresholdMs: number): Promise<Credentials | null> {
  const creds = getCredentials();

  if (!creds?.accessToken) {
    return null;
  }

  // No refresh token = can't refresh, just use what we have
  if (!creds.refreshToken || !refreshConfig) {
    return creds;
  }

  const timeUntilExpiry = creds.expiresAt - Date.now();

  if (timeUntilExpiry <= 0) {
    // Token expired - must wait for refresh
    logWarn('[credential-proxy] Token expired, waiting for refresh...');

    if (!refreshPromise) {
      refreshPromise = doRefresh()
        .then(() => {})
        .finally(() => {
          refreshPromise = null;
        });
    }

    await refreshPromise;
    return getCredentials(); // Return fresh credentials
  }

  if (timeUntilExpiry < thresholdMs) {
    // Token expiring soon - trigger background refresh, but use current token
    logInfo(`[credential-proxy] Token expires in ${Math.round(timeUntilExpiry / 1000)}s, triggering refresh`);

    if (!refreshPromise) {
      refreshPromise = doRefresh()
        .then(() => {})
        .finally(() => {
          refreshPromise = null;
        });
    }
    // Don't await - fire and forget, use current (still valid) token
  }

  return creds;
}

/**
 * Start the credential injector proxy with optional lazy refresh.
 */
export async function startCredentialProxy(options: CredentialProxyOptions): Promise<CredentialProxyHandle> {
  const upstream = new URL(options.upstreamUrl);
  const useHttps = upstream.protocol === 'https:';
  const thresholdMs = options.refresh?.refreshThresholdMs ?? 60_000;

  // Store refresh config for lazy refresh
  refreshConfig = options.refresh ?? null;
  consecutiveFailures = 0;

  const server = http.createServer(async (req, res) => {
    await handleRequest(req, res, upstream, useHttps, thresholdMs);
  });

  // Find available port
  const port = await new Promise<number>((resolve, reject) => {
    const tryPort = options.port ?? 0; // 0 = random available port
    let attempts = 0;
    const maxAttempts = 10;

    const tryListen = (p: number) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
          attempts++;
          tryListen(0); // Try random port
        } else {
          reject(err);
        }
      });

      server.listen(p, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          resolve(addr.port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    };

    tryListen(tryPort);
  });

  const url = `http://127.0.0.1:${port}`;
  logInfo(`[credential-proxy] Started on ${url}, forwarding to ${options.upstreamUrl}`);
  if (refreshConfig) {
    logInfo(`[credential-proxy] Lazy refresh enabled, threshold: ${thresholdMs}ms`);
  }

  // Telemetry for proxy start
  analytics.capture('installer.proxy', {
    action: 'start',
    port,
    refresh_enabled: !!refreshConfig,
  });

  return {
    port,
    url,
    stop: async () => {
      // Clear refresh state
      refreshConfig = null;
      refreshPromise = null;
      consecutiveFailures = 0;
      await stopServer(server);
    },
  };
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstream: URL,
  useHttps: boolean,
  thresholdMs: number,
): Promise<void> {
  // Get valid credentials, potentially triggering refresh
  const creds = await ensureValidCredentials(thresholdMs);

  if (!creds?.accessToken) {
    logError('[credential-proxy] No credentials available');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'credentials_unavailable',
        message: 'Not authenticated. Run `workos login` first.',
      }),
    );
    return;
  }

  // Build upstream request options
  // Concatenate paths properly - URL() would replace the base path with absolute paths
  const requestPath = req.url || '/';
  const basePath = upstream.pathname.replace(/\/$/, ''); // Remove trailing slash
  const fullPath = basePath + requestPath;
  const upstreamUrl = new URL(fullPath, upstream.origin);

  const headers: http.OutgoingHttpHeaders = {};

  // Copy headers, excluding hop-by-hop headers
  const hopByHop = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]);

  for (const [key, value] of Object.entries(req.headers)) {
    if (!hopByHop.has(key.toLowerCase()) && value !== undefined) {
      headers[key] = value;
    }
  }

  // Inject credentials
  headers['authorization'] = `Bearer ${creds.accessToken}`;
  headers['host'] = upstream.host;

  // Strip beta=true query param - WorkOS LLM gateway doesn't support it
  const searchParams = new URLSearchParams(upstreamUrl.search);
  searchParams.delete('beta');
  const queryString = searchParams.toString();
  const finalPath = upstreamUrl.pathname + (queryString ? `?${queryString}` : '');

  const requestOptions: http.RequestOptions = {
    hostname: upstream.hostname,
    port: upstream.port || (useHttps ? 443 : 80),
    path: finalPath,
    method: req.method,
    headers,
    timeout: 120_000, // 2 minute timeout
  };

  const transport = useHttps ? https : http;

  const proxyReq = transport.request(requestOptions, (proxyRes) => {
    // Copy response headers
    const responseHeaders: http.OutgoingHttpHeaders = {};
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (!hopByHop.has(key.toLowerCase()) && value !== undefined) {
        responseHeaders[key] = value;
      }
    }

    res.writeHead(proxyRes.statusCode || 500, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    logError('[credential-proxy] Upstream error:', err.message);

    if (!res.headersSent) {
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'upstream_unavailable',
            message: 'Could not connect to upstream server',
          }),
        );
      } else if ((err as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'upstream_timeout',
            message: 'Upstream server timed out',
          }),
        );
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'proxy_error',
            message: err.message,
          }),
        );
      }
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'upstream_timeout',
          message: 'Upstream server timed out',
        }),
      );
    }
  });

  // Stream request body
  req.pipe(proxyReq);
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // Set a timeout for graceful shutdown
    const timeout = setTimeout(() => {
      logInfo('[credential-proxy] Force closing after timeout');
      server.closeAllConnections?.();
      resolve();
    }, 5000);

    server.close((err) => {
      clearTimeout(timeout);
      if (err) {
        logError('[credential-proxy] Error stopping server:', err);
        reject(err);
      } else {
        logInfo('[credential-proxy] Stopped');
        resolve();
      }
    });
  });
}
