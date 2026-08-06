import type { Integration } from './constants.js';
import { INSTALLER_INTERACTION_EVENT_NAME } from './constants.js';
import { analytics } from '../utils/analytics.js';
import ui, { isCancel, isDashboardMode } from '../utils/ui.js';
import { isPromptAllowed } from '../utils/interaction-mode.js';
import { getConfig as getInstallerSettings } from './settings.js';
import { getCallbackPath } from './port-detection.js';

const WORKOS_API_BASE = 'https://api.workos.com';

/**
 * How many times dashboard auto-config may ask the user to recover from a
 * 401 (re-auth or fresh API key) before giving up. Bounded so a persistently
 * rejected key can never loop the installer — the user can always decline.
 */
const MAX_UNAUTHORIZED_RECOVERIES = 2;

export interface AutoConfigResult {
  redirectUri: { success: boolean; alreadyExists: boolean };
  corsOrigin: { success: boolean; alreadyExists: boolean };
  homepageUrl: { success: boolean };
}

export interface AutoConfigOutcome {
  results: AutoConfigResult;
  /**
   * The API key that ultimately succeeded. Differs from the key passed in
   * when 401 recovery swapped credentials — callers should write THIS key to
   * env files / hand it to the agent, not the rejected one.
   */
  apiKey: string;
}

/**
 * Dashboard configuration call failed with an HTTP status. Carries the status
 * so 401 (Unauthorized) can be detected exactly instead of by string-matching
 * the API's error message.
 */
export class DashboardConfigError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'DashboardConfigError';
  }
}

interface FetchError {
  status: number;
  message: string;
  data?: unknown;
}

async function workosRequest(
  method: 'POST' | 'PUT',
  endpoint: string,
  apiKey: string,
  body: Record<string, string>,
): Promise<Response> {
  return fetch(`${WORKOS_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function parseFetchError(response: Response): Promise<FetchError> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    // Response wasn't JSON
  }
  return {
    status: response.status,
    message: typeof data === 'object' && data && 'message' in data ? String((data as { message: string }).message) : '',
    data,
  };
}

function toDashboardConfigError(error: FetchError): DashboardConfigError {
  return new DashboardConfigError(error.message || `HTTP ${error.status}`, error.status);
}

/**
 * Create a redirect URI in WorkOS.
 * Returns success on 201 or 409 (already exists).
 */
async function createRedirectUri(apiKey: string, uri: string): Promise<{ success: boolean; alreadyExists: boolean }> {
  const response = await workosRequest('POST', '/user_management/redirect_uris', apiKey, { uri });

  if (response.ok) {
    return { success: true, alreadyExists: false };
  }

  const error = await parseFetchError(response);
  // WorkOS returns 422 (not 409) when URI already exists
  if (error.status === 409 || (error.status === 422 && error.message.includes('already exists'))) {
    return { success: true, alreadyExists: true };
  }

  throw toDashboardConfigError(error);
}

/**
 * Create a CORS origin in WorkOS.
 * Returns success on 201 or 409 (already exists).
 */
async function createCorsOrigin(apiKey: string, origin: string): Promise<{ success: boolean; alreadyExists: boolean }> {
  const response = await workosRequest('POST', '/user_management/cors_origins', apiKey, { origin });

  if (response.ok) {
    return { success: true, alreadyExists: false };
  }

  const error = await parseFetchError(response);
  // WorkOS returns 422 (not 409) when origin already exists
  if (error.status === 409 || (error.status === 422 && error.message.includes('already exists'))) {
    return { success: true, alreadyExists: true };
  }

  throw toDashboardConfigError(error);
}

/**
 * Set the app homepage URL in WorkOS.
 */
async function setHomepageUrl(apiKey: string, url: string): Promise<{ success: boolean }> {
  const response = await workosRequest('PUT', '/user_management/app_homepage_url', apiKey, { url });

  if (!response.ok) {
    const error = await parseFetchError(response);
    throw toDashboardConfigError(error);
  }

  return { success: true };
}

export interface AutoConfigOptions {
  /** Custom homepage URL (defaults to http://localhost:{port}) */
  homepageUrl?: string;
  /** Custom redirect URI (defaults to framework convention) */
  redirectUri?: string;
  /**
   * Recovery hook invoked when the WorkOS API rejects the API key with
   * 401 Unauthorized. Should re-authenticate (or collect a fresh key) and
   * return the replacement API key; return null to decline recovery.
   * Invoked at most MAX_UNAUTHORIZED_RECOVERIES times per call, then the
   * manual-setup instructions are shown. Defaults to an interactive prompt
   * (human TTY only); pass explicitly in tests or non-standard flows.
   */
  onUnauthorized?: (attempt: number) => Promise<string | null>;
}

/**
 * Default 401 recovery: explain the likely cause, then offer to
 * re-authenticate (fresh staging credentials via the OAuth login flow) or
 * paste a different API key. Returns null when the user declines, when
 * prompting isn't possible (agent/CI/JSON/dashboard modes), or when re-auth
 * fails to produce a working key.
 */
export async function promptForUnauthorizedRecovery(): Promise<string | null> {
  if (!isPromptAllowed() || isDashboardMode()) return null;

  const choice = await ui.select<'reauth' | 'apikey' | 'manual'>({
    message: 'How would you like to proceed?',
    options: [
      {
        value: 'reauth',
        label: 'Re-authenticate with WorkOS',
        hint: 'Sign in again to get fresh credentials, then retry',
      },
      {
        value: 'apikey',
        label: 'Enter a different API key',
        hint: 'Paste a key from the WorkOS dashboard',
      },
      {
        value: 'manual',
        label: 'Configure manually',
        hint: 'Show the exact dashboard settings to set yourself',
      },
    ],
  });

  if (isCancel(choice) || choice === 'manual') return null;

  if (choice === 'apikey') {
    const value = await ui.password({
      message: 'Enter your WorkOS API Key',
      validate: (v) => (v.trim() ? undefined : 'API Key is required'),
    });
    return isCancel(value) ? null : value.trim();
  }

  // Re-authenticate: refresh/login via the OAuth device flow, then pull fresh
  // staging credentials — the same source the installer provisions at login.
  // Dynamic imports avoid an import cycle with the auth modules.
  try {
    const { ensureAuthenticated } = await import('./ensure-auth.js');
    const auth = await ensureAuthenticated();
    if (!auth.authenticated) return null;

    const { getAccessToken, saveStagingCredentials } = await import('./credentials.js');
    const token = getAccessToken();
    if (!token) return null;

    const { fetchStagingCredentials } = await import('./staging-api.js');
    const staging = await fetchStagingCredentials(token);
    saveStagingCredentials(staging);
    ui.log.success('Re-authenticated with WorkOS');
    return staging.apiKey;
  } catch (error) {
    ui.log.warn(`Re-authentication failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof DashboardConfigError && error.status === 401;
}

/** Explain why a 401 happened and what actually fixes it. */
function explainUnauthorized(): void {
  ui.log.warn('WorkOS rejected the API key (401 Unauthorized).');
  ui.log.info('  This usually means the key expired, was revoked, or belongs to a different environment.');
}

/** Print the exact dashboard settings the user would need to apply by hand. */
function showManualInstructions(callbackUrl: string, baseUrl: string, homepageUrl: string): void {
  const dashboardUrl = getInstallerSettings().documentation.dashboardUrl;
  ui.log.info(`You can configure these settings manually in the WorkOS dashboard (${dashboardUrl}):`);
  ui.rows([
    { key: 'Redirect URI', value: callbackUrl, status: 'User Management → Redirects', statusKind: 'muted' },
    { key: 'CORS origin', value: baseUrl, status: 'User Management → CORS', statusKind: 'muted' },
    { key: 'Homepage URL', value: homepageUrl, status: 'User Management → Branding', statusKind: 'muted' },
  ]);
}

/**
 * Auto-configure WorkOS dashboard settings for local development.
 * Sets redirect URI, CORS origin, and homepage URL via the WorkOS API.
 *
 * On 401 Unauthorized, offers a bounded recovery path (re-authenticate or
 * enter a fresh API key, then retry) before falling back to specific manual
 * setup instructions. Other failures keep the previous behavior: log and
 * fall back to manual setup without blocking the wizard.
 *
 * @param apiKey - WorkOS API key (sk_xxx)
 * @param integration - Framework integration type
 * @param port - Detected or default dev server port
 * @param options - Optional overrides for homepage URL, redirect URI, and 401 recovery
 *
 * @returns The config results plus the API key that worked, or null when
 * configuration failed and the user was pointed at manual setup.
 */
export async function autoConfigureWorkOSEnvironment(
  apiKey: string,
  integration: Integration,
  port: number,
  options: AutoConfigOptions = {},
): Promise<AutoConfigOutcome | null> {
  const baseUrl = `http://localhost:${port}`;
  const callbackPath = getCallbackPath(integration);
  const callbackUrl = options.redirectUri || `${baseUrl}${callbackPath}`;
  const homepageUrlValue = options.homepageUrl || baseUrl;

  ui.log.step('Configuring WorkOS dashboard settings...');

  let currentApiKey = apiKey;
  let recoveryAttempts = 0;

  while (true) {
    try {
      const [redirectUri, corsOrigin, homepageUrl] = await Promise.all([
        createRedirectUri(currentApiKey, callbackUrl),
        createCorsOrigin(currentApiKey, baseUrl),
        setHomepageUrl(currentApiKey, homepageUrlValue),
      ]);

      const results: AutoConfigResult = { redirectUri, corsOrigin, homepageUrl };

      analytics.capture(INSTALLER_INTERACTION_EVENT_NAME, {
        action: 'workos environment auto-configured',
        integration,
        port,
        redirectUri: redirectUri.alreadyExists ? 'existed' : 'created',
        corsOrigin: corsOrigin.alreadyExists ? 'existed' : 'created',
        recoveredAfterUnauthorized: recoveryAttempts > 0,
      });

      // Aligned key/value feedback: value in accent, a dim status for "already
      // existed" vs. a green status for a fresh create/update.
      ui.log.success('WorkOS dashboard configured');
      ui.rows([
        {
          key: 'Redirect URI',
          value: callbackUrl,
          status: redirectUri.alreadyExists ? 'already set' : 'created',
          statusKind: redirectUri.alreadyExists ? 'muted' : 'ok',
        },
        {
          key: 'CORS origin',
          value: baseUrl,
          status: corsOrigin.alreadyExists ? 'already set' : 'created',
          statusKind: corsOrigin.alreadyExists ? 'muted' : 'ok',
        },
        { key: 'Homepage URL', value: homepageUrlValue, status: 'updated', statusKind: 'ok' },
      ]);

      return { results, apiKey: currentApiKey };
    } catch (error) {
      // 401 — offer re-auth + retry before giving up. Bounded by
      // MAX_UNAUTHORIZED_RECOVERIES; declining also ends the loop.
      if (isUnauthorized(error) && recoveryAttempts < MAX_UNAUTHORIZED_RECOVERIES) {
        explainUnauthorized();
        const recover = options.onUnauthorized ?? promptForUnauthorizedRecovery;
        recoveryAttempts++;

        let freshApiKey: string | null = null;
        try {
          freshApiKey = await recover(recoveryAttempts);
        } catch (recoveryError) {
          ui.log.warn(
            `Credential recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
          );
        }

        if (freshApiKey && freshApiKey !== currentApiKey) {
          analytics.capture(INSTALLER_INTERACTION_EVENT_NAME, {
            action: 'workos environment auto-config retry after re-auth',
            integration,
            attempt: recoveryAttempts,
          });
          ui.log.step('Retrying WorkOS dashboard configuration...');
          currentApiKey = freshApiKey;
          continue;
        }
        // Declined (or recovery produced no new key) → manual instructions below.
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      const status = error instanceof DashboardConfigError ? error.status : undefined;

      // Provide specific guidance for common errors
      if (status === 401) {
        // Recovery was declined or exhausted above — the cause was already explained.
        ui.log.warn('Could not configure WorkOS dashboard: Unauthorized');
      } else if (status === 403 || message.includes('permission')) {
        ui.log.warn('Could not configure WorkOS dashboard: API key lacks permission');
      } else if (status === 422) {
        ui.log.warn(`Could not configure WorkOS dashboard: Validation error`);
        ui.log.info(`  Error: ${message}`);
      } else {
        ui.log.warn(`Could not configure WorkOS dashboard: ${message}`);
      }

      showManualInstructions(callbackUrl, baseUrl, homepageUrlValue);

      analytics.capture(INSTALLER_INTERACTION_EVENT_NAME, {
        action: 'workos environment auto-config failed',
        integration,
        error: message,
        status,
        recoveryAttempts,
      });

      return null;
    }
  }
}
