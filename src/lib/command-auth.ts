/**
 * Command-path auth for dashboard-plane resource commands.
 *
 * `refreshIfExpired()` is the shared refresh core extracted from
 * `ensure-auth.ts`: it owns "is this session usable, and can it be made usable
 * silently?" and stays policy-free about what to do when it can't. The two
 * callers own their dead-session policy:
 *
 * - Install flows (`ensureAuthenticated()` in `ensure-auth.ts`) launch the
 *   login flow (or exit 4 when prompting isn't allowed).
 * - Resource commands (`requireCommandToken()` here) always exit 4 with a
 *   structured error — they never open a browser.
 *
 * Environment-scoped resource commands (`organization`, `user`, `role`, …)
 * only reach `requireCommandToken()` when no API key applies: with
 * `--api-key`, `WORKOS_API_KEY` or an unclaimed active profile they run on the
 * REST API instead (see `resource-auth.ts`). So the `*ApiKeySet` copy below is
 * in practice shown by the account-plane commands (`team`, `project`,
 * `environment`, `whoami`), which have no API-key equivalent.
 */

import {
  getCredentials,
  hasCredentials,
  updateTokens,
  isTokenExpired,
  clearCredentials,
  type Credentials,
} from './credentials.js';
import { refreshAccessToken } from './token-refresh-client.js';
import { getCliAuthClientId, getAuthkitDomain } from './settings.js';
import { logInfo } from '../utils/debug.js';
import { exitWithAuthRequired } from '../utils/exit-codes.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

export interface UsableSession {
  accessToken: string;
  /** True when the token was silently refreshed during this call. */
  refreshed: boolean;
}

/**
 * User-facing error copy for the dashboard (account-plane) command surface.
 *
 * Getters, not plain strings: the copy embeds `formatWorkOSCommand()`, which
 * inspects the npm environment at call time (`workos` vs `npx workos@latest`),
 * so evaluation must be deferred to access time. `Object.entries()` still
 * yields plain strings, which `no-graphql-leak.spec.ts` iterates — never name
 * GraphQL (or other internal terms) in these messages.
 */
export const DASHBOARD_ERROR_MESSAGES: Record<
  'authRequired' | 'authRequiredApiKeySet' | 'refreshFailed' | 'refreshFailedApiKeySet' | 'forbidden',
  string
> = {
  /** No usable session: never logged in, or the session is dead. */
  get authRequired() {
    return (
      `Not logged in. Run \`${formatWorkOSCommand('auth login')}\` to authenticate, ` +
      `or use \`${formatWorkOSCommand('api')}\` for API-key requests.`
    );
  },
  /**
   * Same as `authRequired`, but WORKOS_API_KEY is set. Resource commands use
   * the key, so this is reached by the account-plane commands, which manage
   * the dashboard account itself and need a login: say which is which.
   */
  get authRequiredApiKeySet() {
    return (
      'Not logged in. WORKOS_API_KEY is set, but this command manages your WorkOS dashboard account ' +
      '(team, projects, environments) and needs a dashboard login. ' +
      `Resource commands such as \`${formatWorkOSCommand('organization')}\` and \`${formatWorkOSCommand('user')}\` run with the API key. ` +
      `Run \`${formatWorkOSCommand('auth login')}\` to authenticate, ` +
      `or use \`${formatWorkOSCommand('api')}\` for API-key requests.`
    );
  },
  /** Transient refresh failure: the session may still be fine — say so. */
  get refreshFailed() {
    return (
      'Could not refresh your session (network or server error). Your saved login was kept. ' +
      `Try again, run \`${formatWorkOSCommand('auth login')}\` to re-authenticate, ` +
      `or use \`${formatWorkOSCommand('api')}\` for API-key requests.`
    );
  },
  /** Transient refresh failure while WORKOS_API_KEY is set: same, plus which commands the key covers. */
  get refreshFailedApiKeySet() {
    return (
      'Could not refresh your session (network or server error). Your saved login was kept. ' +
      'WORKOS_API_KEY is set, but this command manages your WorkOS dashboard account and needs a dashboard login. ' +
      `Resource commands such as \`${formatWorkOSCommand('organization')}\` and \`${formatWorkOSCommand('user')}\` run with the API key. ` +
      `Try again, run \`${formatWorkOSCommand('auth login')}\` to re-authenticate, ` +
      `or use \`${formatWorkOSCommand('api')}\` for API-key requests.`
    );
  },
  /** 403 from the dashboard plane: capability off for the team, or no team. */
  get forbidden() {
    return (
      'This account-plane capability is not enabled for this team, your team role does not allow it, ' +
      'or the logged-in account is not backed by a WorkOS dashboard team.'
    );
  },
};

/**
 * Return a usable access token, refreshing silently when the stored one has
 * expired; `null` when no usable session exists (or can be minted).
 *
 * Side effects mirror the original `ensure-auth.ts` semantics verbatim:
 * - refresh success → tokens persisted via `updateTokens()`
 * - `invalid_grant` → credentials cleared (the session is dead)
 * - network/server refresh errors → credentials KEPT for retry
 * - no credentials / no refresh path → credentials cleared (corrupt-file cleanup)
 *
 * Deliberately policy-free about the dead-session case: callers can derive the
 * reason from observable store state (credentials surviving the call means the
 * failure was transient).
 *
 * Callers that already read the store may pass `creds` to skip the (keyring
 * IPC) re-read; the default preserves the zero-argument contract.
 */
export async function refreshIfExpired(creds: Credentials | null = getCredentials()): Promise<UsableSession | null> {
  // No credentials (or unreadable/corrupt) — clean up any leftover files.
  if (!creds) {
    clearCredentials();
    return null;
  }

  if (!isTokenExpired(creds)) {
    return { accessToken: creds.accessToken, refreshed: false };
  }

  if (creds.refreshToken) {
    const clientId = getCliAuthClientId();
    const authkitDomain = getAuthkitDomain();

    if (clientId && authkitDomain) {
      logInfo('[token-lifecycle] Access token expired, attempting refresh');
      const refreshResult = await refreshAccessToken(authkitDomain, clientId);

      if (refreshResult.success && refreshResult.accessToken && refreshResult.expiresAt) {
        updateTokens(refreshResult.accessToken, refreshResult.expiresAt, refreshResult.refreshToken);
        return { accessToken: refreshResult.accessToken, refreshed: true };
      }

      if (refreshResult.errorType === 'invalid_grant') {
        // The refresh token was rejected: the session is dead, and stale
        // credentials would only mislead the next invocation.
        logInfo('[token-lifecycle] Refresh token rejected (invalid_grant), clearing credentials');
        clearCredentials();
        return null;
      }

      // Network or server error — transient. A flaky network must not
      // silently delete a working session.
      logInfo(`[token-lifecycle] Refresh failed (${refreshResult.errorType}), keeping credentials for retry`);
      return null;
    }
  }

  // Expired with no refresh token (or no client config to refresh with).
  logInfo('[token-lifecycle] No usable refresh path, clearing credentials');
  clearCredentials();
  return null;
}

/**
 * Command-path guard: resolve a usable bearer token (refreshing silently if
 * needed) or exit 4 with a structured `auth_required` error. Never opens a
 * browser or triggers the login flow. Never returns on failure.
 */
export async function requireCommandToken(): Promise<string> {
  const creds = getCredentials();
  const hadSession = creds !== null;

  const session = await refreshIfExpired(creds);
  if (session) {
    return session.accessToken;
  }

  // Credentials surviving the refresh attempt means the failure was transient
  // (network/server); the user is NOT logged out and must not be told so.
  if (hadSession && hasCredentials()) {
    exitWithAuthRequired(
      process.env.WORKOS_API_KEY
        ? DASHBOARD_ERROR_MESSAGES.refreshFailedApiKeySet
        : DASHBOARD_ERROR_MESSAGES.refreshFailed,
    );
  }

  exitWithAuthRequired(
    process.env.WORKOS_API_KEY ? DASHBOARD_ERROR_MESSAGES.authRequiredApiKeySet : DASHBOARD_ERROR_MESSAGES.authRequired,
  );
}
