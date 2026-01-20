import type { Integration } from './constants.js';
import { WIZARD_INTERACTION_EVENT_NAME } from './constants.js';
import { analytics } from '../utils/analytics.js';
import clack from '../utils/clack.js';
import { getCallbackPath } from './port-detection.js';

const WORKOS_API_BASE = 'https://api.workos.com';

export interface AutoConfigResult {
  redirectUri: { success: boolean; alreadyExists: boolean };
  corsOrigin: { success: boolean; alreadyExists: boolean };
  homepageUrl: { success: boolean };
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
 * Set the app homepage URL in WorkOS.
 */
async function setHomepageUrl(apiKey: string, url: string): Promise<{ success: boolean }> {
  const response = await workosRequest('PUT', '/user_management/app_homepage_url', apiKey, { url });

  if (!response.ok) {
    const error = await parseFetchError(response);
    throw new Error(error.message || `HTTP ${error.status}`);
  }

  return { success: true };
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

  clack.log.step('Configuring WorkOS dashboard settings via API...');
  clack.log.info(`  Redirect URI: ${callbackUrl}`);
  clack.log.info(`  CORS origin: ${baseUrl}`);
  clack.log.info(`  Homepage URL: ${homepageUrlValue}`);

  try {
    const [redirectUri, corsOrigin, homepageUrl] = await Promise.all([
      createRedirectUri(apiKey, callbackUrl),
      createCorsOrigin(apiKey, baseUrl),
      setHomepageUrl(apiKey, homepageUrlValue),
    ]);

    const results: AutoConfigResult = { redirectUri, corsOrigin, homepageUrl };

    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'workos environment auto-configured',
      integration,
      port,
      redirectUri: redirectUri.alreadyExists ? 'existed' : 'created',
      corsOrigin: corsOrigin.alreadyExists ? 'existed' : 'created',
    });

    // Build user feedback
    const messages: string[] = [];
    messages.push(
      redirectUri.alreadyExists
        ? `Redirect URI: ${callbackUrl} (already existed)`
        : `Redirect URI: ${callbackUrl} (created)`,
    );
    messages.push(
      corsOrigin.alreadyExists ? `CORS origin: ${baseUrl} (already existed)` : `CORS origin: ${baseUrl} (created)`,
    );
    messages.push(`Homepage URL: ${homepageUrlValue} (updated)`);

    clack.log.success('WorkOS dashboard configured:\n  ' + messages.join('\n  '));

    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Provide specific guidance for common errors
    if (message.includes('401') || message.includes('Invalid API key')) {
      clack.log.warn('Could not configure WorkOS dashboard: Invalid API key');
    } else if (message.includes('403') || message.includes('permission')) {
      clack.log.warn('Could not configure WorkOS dashboard: API key lacks permission');
    } else if (message.includes('422') || message.includes('Validation')) {
      clack.log.warn(`Could not configure WorkOS dashboard: Validation error`);
      clack.log.info(`  Error: ${message}`);
    } else {
      clack.log.warn(`Could not configure WorkOS dashboard: ${message}`);
    }

    clack.log.info('You can configure these settings manually in the WorkOS dashboard.');

    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'workos environment auto-config failed',
      integration,
      error: message,
    });

    return null;
  }
}
