import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { outputSuccess, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('Config');

export async function runConfigRedirectAdd(uri: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.redirectUris.add(uri);

    if (result.alreadyExists) {
      if (isJsonMode()) {
        outputSuccess('Redirect URI already exists', { uri, alreadyExists: true });
      } else {
        console.log(chalk.yellow('Redirect URI already exists (no change)'));
      }
      return;
    }

    outputSuccess('Added redirect URI', { uri });
  } catch (error) {
    handleApiError(error);
  }
}

export async function runConfigCorsAdd(origin: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.corsOrigins.add(origin);

    if (result.alreadyExists) {
      if (isJsonMode()) {
        outputSuccess('CORS origin already exists', { origin, alreadyExists: true });
      } else {
        console.log(chalk.yellow('CORS origin already exists (no change)'));
      }
      return;
    }

    outputSuccess('Added CORS origin', { origin });
  } catch (error) {
    handleApiError(error);
  }
}

export async function runConfigHomepageUrlSet(url: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.homepageUrl.set(url);
    outputSuccess('Set homepage URL', { url });
  } catch (error) {
    handleApiError(error);
  }
}
