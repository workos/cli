import axios from 'axios';
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

/**
 * Create a redirect URI in WorkOS.
 * Returns success on 201 or 409 (already exists).
 */
async function createRedirectUri(
  apiKey: string,
  uri: string,
): Promise<{ success: boolean; alreadyExists: boolean }> {
  try {
    await axios.post(
      `${WORKOS_API_BASE}/user_management/redirect_uris`,
      { uri },
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    return { success: true, alreadyExists: false };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message || '';
      // WorkOS returns 422 (not 409) when URI already exists
      if (
        status === 409 ||
        (status === 422 && message.includes('already exists'))
      ) {
        return { success: true, alreadyExists: true };
      }
    }
    throw error;
  }
}

/**
 * Create a CORS origin in WorkOS.
 * Returns success on 201 or 409 (already exists).
 */
async function createCorsOrigin(
  apiKey: string,
  origin: string,
): Promise<{ success: boolean; alreadyExists: boolean }> {
  try {
    await axios.post(
      `${WORKOS_API_BASE}/user_management/cors_origins`,
      { origin },
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    return { success: true, alreadyExists: false };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message || '';
      // WorkOS returns 422 (not 409) when origin already exists
      if (
        status === 409 ||
        (status === 422 && message.includes('already exists'))
      ) {
        return { success: true, alreadyExists: true };
      }
    }
    throw error;
  }
}

/**
 * Set the app homepage URL in WorkOS.
 */
async function setHomepageUrl(
  apiKey: string,
  url: string,
): Promise<{ success: boolean }> {
  await axios.put(
    `${WORKOS_API_BASE}/user_management/app_homepage_url`,
    { url },
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
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
      corsOrigin.alreadyExists
        ? `CORS origin: ${baseUrl} (already existed)`
        : `CORS origin: ${baseUrl} (created)`,
    );
    messages.push(`Homepage URL: ${homepageUrlValue} (updated)`);

    clack.log.success(
      'WorkOS dashboard configured:\n  ' + messages.join('\n  '),
    );

    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Provide specific guidance for common errors
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const responseData = error.response?.data;
      const errorDetail =
        typeof responseData === 'object'
          ? JSON.stringify(responseData)
          : responseData;

      if (status === 401) {
        clack.log.warn('Could not configure WorkOS dashboard: Invalid API key');
      } else if (status === 403) {
        clack.log.warn(
          'Could not configure WorkOS dashboard: API key lacks permission',
        );
      } else if (status === 422) {
        clack.log.warn(
          `Could not configure WorkOS dashboard: Validation error`,
        );
        clack.log.info(`  API response: ${errorDetail}`);
      } else {
        clack.log.warn(`Could not configure WorkOS dashboard: ${message}`);
        if (errorDetail) {
          clack.log.info(`  API response: ${errorDetail}`);
        }
      }
    } else {
      clack.log.warn(`Could not configure WorkOS dashboard: ${message}`);
    }

    clack.log.info(
      'You can configure these settings manually in the WorkOS dashboard.',
    );

    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'workos environment auto-config failed',
      integration,
      error: message,
    });

    return null;
  }
}
