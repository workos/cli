/**
 * Background token refresh loop.
 * Runs in main wizard process, refreshes tokens before expiry,
 * writes to credentials file for proxy to read.
 */

import { logInfo, logError, logWarn } from '../utils/debug.js';
import { getCredentials, updateTokens } from './credentials.js';
import { refreshAccessToken, tokenNeedsRefresh } from './token-refresh-client.js';
import { analytics } from '../utils/analytics.js';

export interface BackgroundRefreshOptions {
  /** AuthKit domain for refresh endpoint */
  authkitDomain: string;
  /** OAuth client ID */
  clientId: string;
  /** Check interval in ms (default: 30000) */
  intervalMs?: number;
  /** Refresh threshold in ms before expiry (default: 120000 = 2 min) */
  refreshThresholdMs?: number;
  /** Callback when refresh fails permanently */
  onRefreshExpired?: () => void;
  /** Callback when refresh succeeds */
  onRefreshSuccess?: () => void;
}

export interface BackgroundRefreshHandle {
  /** Stop the refresh loop */
  stop: () => void;
  /** Check if the loop is running */
  isRunning: () => boolean;
}

/**
 * Start background token refresh loop.
 */
export function startBackgroundRefresh(options: BackgroundRefreshOptions): BackgroundRefreshHandle {
  const {
    authkitDomain,
    clientId,
    intervalMs = 30_000,
    refreshThresholdMs = 2 * 60 * 1000,
    onRefreshExpired,
    onRefreshSuccess,
  } = options;

  let isRunning = true;
  let intervalId: NodeJS.Timeout | null = null;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  const checkAndRefresh = async () => {
    if (!isRunning) return;

    const creds = getCredentials();

    if (!creds?.refreshToken) {
      logWarn('[background-refresh] No refresh token available');
      return;
    }

    if (!tokenNeedsRefresh(creds.expiresAt, refreshThresholdMs)) {
      // Token still valid, nothing to do
      const timeUntilExpiry = creds.expiresAt - Date.now();
      logInfo(`[background-refresh] Token valid for ${Math.round(timeUntilExpiry / 1000)}s`);
      return;
    }

    logInfo('[background-refresh] Token needs refresh, initiating...');

    analytics.capture('installer.token.refresh', {
      action: 'refresh_attempt',
      trigger: 'proactive',
      time_until_expiry_ms: creds.expiresAt - Date.now(),
    });

    const startTime = Date.now();
    const result = await refreshAccessToken(authkitDomain, clientId);

    if (result.success && result.accessToken && result.expiresAt) {
      // Update credentials file atomically
      updateTokens(result.accessToken, result.expiresAt, result.refreshToken);

      consecutiveFailures = 0;
      const durationMs = Date.now() - startTime;

      logInfo(
        `[background-refresh] Token refreshed in ${durationMs}ms, new expiry: ${new Date(result.expiresAt).toISOString()}`,
      );

      analytics.capture('installer.token.refresh', {
        action: 'refresh_success',
        duration_ms: durationMs,
        token_rotated: !!result.refreshToken,
      });

      onRefreshSuccess?.();
    } else {
      consecutiveFailures++;

      logError(`[background-refresh] Refresh failed: ${result.error}`);

      analytics.capture('installer.token.refresh', {
        action: 'refresh_failure',
        error_type: result.errorType || 'unknown',
        error_message: result.error || 'Unknown error',
        consecutive_failures: consecutiveFailures,
      });

      // Handle permanent failure (refresh token expired)
      if (result.errorType === 'invalid_grant') {
        logError('[background-refresh] Refresh token expired, stopping refresh loop');
        stop();
        onRefreshExpired?.();
        return;
      }

      // Handle too many consecutive transient failures
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logError(`[background-refresh] ${MAX_CONSECUTIVE_FAILURES} consecutive failures, stopping`);
        stop();
        onRefreshExpired?.();
      }
    }
  };

  const stop = () => {
    isRunning = false;
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    logInfo('[background-refresh] Stopped');
  };

  // Run immediately, then on interval
  checkAndRefresh();
  intervalId = setInterval(checkAndRefresh, intervalMs);

  logInfo(`[background-refresh] Started, checking every ${intervalMs}ms`);

  return {
    stop,
    isRunning: () => isRunning,
  };
}
