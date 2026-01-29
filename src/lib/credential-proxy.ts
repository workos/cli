/**
 * Lightweight HTTP proxy that injects credentials from file into requests.
 * Follows Anthropic's recommended credential injection pattern.
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { logInfo, logError } from '../utils/debug.js';
import { getCredentials } from './credentials.js';

export interface CredentialProxyOptions {
  /** Upstream URL to forward requests to */
  upstreamUrl: string;
  /** Optional: specific port to bind (default: random) */
  port?: number;
}

export interface CredentialProxyHandle {
  /** Port the proxy is listening on */
  port: number;
  /** Full URL for the proxy (e.g., http://localhost:54321) */
  url: string;
  /** Stop the proxy server */
  stop: () => Promise<void>;
}

/**
 * Start the credential injector proxy.
 */
export async function startCredentialProxy(options: CredentialProxyOptions): Promise<CredentialProxyHandle> {
  const upstream = new URL(options.upstreamUrl);
  const useHttps = upstream.protocol === 'https:';

  const server = http.createServer(async (req, res) => {
    await handleRequest(req, res, upstream, useHttps);
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

  return {
    port,
    url,
    stop: () => stopServer(server),
  };
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstream: URL,
  useHttps: boolean,
): Promise<void> {
  // Read fresh token from credentials file
  const creds = getCredentials();

  if (!creds?.accessToken) {
    logError('[credential-proxy] No credentials available');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'credentials_unavailable',
        message: 'Not authenticated. Run `wizard login` first.',
      }),
    );
    return;
  }

  // Build upstream request options
  const upstreamPath = req.url || '/';
  const upstreamUrl = new URL(upstreamPath, upstream);

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

  const requestOptions: http.RequestOptions = {
    hostname: upstream.hostname,
    port: upstream.port || (useHttps ? 443 : 80),
    path: upstreamUrl.pathname + upstreamUrl.search,
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

import { startBackgroundRefresh, BackgroundRefreshOptions, BackgroundRefreshHandle } from './background-refresh.js';

export interface FullProxyOptions extends CredentialProxyOptions {
  /** Options for background refresh */
  refresh: Omit<BackgroundRefreshOptions, 'onRefreshExpired'>;
  /** Callback when refresh fails permanently */
  onRefreshExpired?: () => void;
}

export interface FullProxyHandle extends CredentialProxyHandle {
  /** Handle to the background refresh loop */
  refreshHandle: BackgroundRefreshHandle;
}

/**
 * Start credential proxy with background refresh.
 * Convenience function that starts both components together.
 */
export async function startCredentialProxyWithRefresh(options: FullProxyOptions): Promise<FullProxyHandle> {
  const proxyHandle = await startCredentialProxy({
    upstreamUrl: options.upstreamUrl,
    port: options.port,
  });

  const refreshHandle = startBackgroundRefresh({
    ...options.refresh,
    onRefreshExpired: () => {
      options.onRefreshExpired?.();
    },
  });

  const originalStop = proxyHandle.stop;

  return {
    ...proxyHandle,
    refreshHandle,
    stop: async () => {
      refreshHandle.stop();
      await originalStop();
    },
  };
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
