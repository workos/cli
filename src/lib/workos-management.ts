import type { Integration } from './constants.js';
import type { EnvironmentConfig } from './config-store.js';
import { INSTALLER_INTERACTION_EVENT_NAME } from './constants.js';
import { analytics } from '../utils/analytics.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import ui from '../utils/ui.js';
import { getActiveEnvironment, isUnclaimedEnvironment } from './config-store.js';
import { getCallbackPath } from './port-detection.js';

const WORKOS_API_BASE = 'https://api.workos.com';

const HOMEPAGE_URL_ENDPOINT = '/user_management/app_homepage_url';

/** Provenance wording when no stored environment can be named. */
const SUPPLIED_KEY_PROVENANCE = 'the API key supplied to this run';

export interface AutoConfigResult {
  redirectUri: { success: boolean; alreadyExists: boolean };
  corsOrigin: { success: boolean; alreadyExists: boolean };
  homepageUrl: { success: boolean; alreadyExists: boolean };
}

interface FetchError {
  status: number;
  message: string;
  data?: unknown;
}

async function workosRequest(
  method: 'GET' | 'POST' | 'PUT',
  endpoint: string,
  apiKey: string,
  body?: Record<string, string>,
): Promise<Response> {
  return fetch(`${WORKOS_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // Only declare a body's type when there is a body. A bodyless GET that
      // claims `application/json` is malformed, and strict proxies may reject it.
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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

  throw new Error(error.message || `HTTP ${error.status}`);
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

  throw new Error(error.message || `HTTP ${error.status}`);
}

/**
 * Set the app homepage URL in WorkOS, skipping the write when it already matches.
 *
 * The homepage URL is a single-valued setting, so an unconditional PUT silently
 * overwrites whatever a logged-in user already had configured. Reading first
 * makes the common case a no-op that reports itself honestly.
 *
 * A read failure is not fatal: fall through to the PUT, which is the old
 * behavior, rather than abandoning configuration over a GET we just added.
 */
async function setHomepageUrl(apiKey: string, url: string): Promise<{ success: boolean; alreadyExists: boolean }> {
  try {
    const current = await workosRequest('GET', HOMEPAGE_URL_ENDPOINT, apiKey);
    if (current.ok) {
      const data = (await current.json()) as { url?: string } | null;
      if (data?.url === url) {
        return { success: true, alreadyExists: true };
      }
    }
  } catch {
    // Read failed (endpoint missing, non-JSON body, network error) — fall
    // through to the write so behavior is never worse than before.
  }

  const response = await workosRequest('PUT', HOMEPAGE_URL_ENDPOINT, apiKey, { url });

  if (!response.ok) {
    const error = await parseFetchError(response);
    throw new Error(error.message || `HTTP ${error.status}`);
  }

  return { success: true, alreadyExists: false };
}

/**
 * Where the credentials being used came from, so the rows below say *where* the
 * writes landed and not just what was written.
 *
 * Derived locally: the WorkOS API exposes no environment identity this module
 * can reach (`workosRequest` is GET/POST/PUT against user_management only, and
 * the config store holds no environment id). `activeEnvironment.name` is a
 * local label, so it is only ever a parenthetical, never an authoritative id.
 *
 * The stored active environment is only named when its key is the one that
 * actually did the writes — `--api-key` (or `WORKOS_API_KEY`) bypasses the
 * store entirely, and naming an untouched environment is exactly the confusion
 * this row exists to prevent.
 */
function describeCredentialProvenance(apiKey: string): string {
  let activeEnv: EnvironmentConfig | null = null;
  try {
    activeEnv = getActiveEnvironment();
  } catch {
    // Keyring locked or unavailable — a label is not worth aborting over.
    return SUPPLIED_KEY_PROVENANCE;
  }

  if (!activeEnv || activeEnv.apiKey !== apiKey) return SUPPLIED_KEY_PROVENANCE;

  if (isUnclaimedEnvironment(activeEnv)) {
    return `a new unclaimed environment (${activeEnv.name}) — run \`${formatWorkOSCommand('profile claim')}\` to keep it`;
  }

  return `your active environment (${activeEnv.name})`;
}

export interface AutoConfigOptions {
  /** Custom homepage URL (defaults to http://localhost:{port}) */
  homepageUrl?: string;
  /** Custom redirect URI (defaults to framework convention) */
  redirectUri?: string;
}

/**
 * Auto-configure WorkOS dashboard settings for local development.
 * Sets redirect URI, CORS origin, and homepage URL via the WorkOS API.
 *
 * @param apiKey - WorkOS API key (sk_xxx)
 * @param integration - Framework integration type
 * @param port - Detected or default dev server port
 * @param options - Optional overrides for homepage URL and redirect URI
 *
 * Non-blocking: failures are logged but don't stop the wizard.
 */
export async function autoConfigureWorkOSEnvironment(
  apiKey: string,
  integration: Integration,
  port: number,
  options: AutoConfigOptions = {},
): Promise<AutoConfigResult | null> {
  const baseUrl = `http://localhost:${port}`;
  const callbackPath = getCallbackPath(integration);
  const callbackUrl = options.redirectUri || `${baseUrl}${callbackPath}`;
  const homepageUrlValue = options.homepageUrl || baseUrl;

  ui.log.step('Configuring WorkOS dashboard settings...');

  try {
    const [redirectUri, corsOrigin, homepageUrl] = await Promise.all([
      createRedirectUri(apiKey, callbackUrl),
      createCorsOrigin(apiKey, baseUrl),
      setHomepageUrl(apiKey, homepageUrlValue),
    ]);

    const results: AutoConfigResult = { redirectUri, corsOrigin, homepageUrl };

    analytics.capture(INSTALLER_INTERACTION_EVENT_NAME, {
      action: 'workos environment auto-configured',
      integration,
      port,
      redirectUri: redirectUri.alreadyExists ? 'existed' : 'created',
      corsOrigin: corsOrigin.alreadyExists ? 'existed' : 'created',
      homepageUrl: homepageUrl.alreadyExists ? 'existed' : 'updated',
    });

    // Aligned key/value feedback: value in accent, a dim status for "already
    // existed" vs. a green status for a fresh create/update. The provenance row
    // comes first — it is the context for the three rows below it.
    ui.log.success('WorkOS dashboard configured');
    ui.rows([
      { key: 'Environment', value: describeCredentialProvenance(apiKey), statusKind: 'muted' },
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
      {
        key: 'Homepage URL',
        value: homepageUrlValue,
        status: homepageUrl.alreadyExists ? 'already set' : 'updated',
        statusKind: homepageUrl.alreadyExists ? 'muted' : 'ok',
      },
    ]);

    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Provide specific guidance for common errors
    if (message.includes('401') || message.includes('Invalid API key')) {
      ui.log.warn('Could not configure WorkOS dashboard: Invalid API key');
    } else if (message.includes('403') || message.includes('permission')) {
      ui.log.warn('Could not configure WorkOS dashboard: API key lacks permission');
    } else if (message.includes('422') || message.includes('Validation')) {
      ui.log.warn(`Could not configure WorkOS dashboard: Validation error`);
      ui.log.info(`  Error: ${message}`);
    } else {
      ui.log.warn(`Could not configure WorkOS dashboard: ${message}`);
    }

    ui.log.info('You can configure these settings manually in the WorkOS dashboard.');

    analytics.capture(INSTALLER_INTERACTION_EVENT_NAME, {
      action: 'workos environment auto-config failed',
      integration,
      error: message,
    });

    return null;
  }
}
