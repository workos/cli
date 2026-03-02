import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('Portal');

export interface PortalGenerateOptions {
  intent: string;
  organization: string;
  returnUrl?: string;
  successUrl?: string;
}

export async function runPortalGenerateLink(
  options: PortalGenerateOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.portal.generateLink({
      intent: options.intent as Parameters<typeof client.sdk.portal.generateLink>[0]['intent'],
      organization: options.organization,
      ...(options.returnUrl && { returnUrl: options.returnUrl }),
      ...(options.successUrl && { successUrl: options.successUrl }),
    });

    if (isJsonMode()) {
      outputJson(result);
      return;
    }

    console.log(result.link);
    console.log(chalk.dim('Note: Portal links expire after 5 minutes.'));
  } catch (error) {
    handleApiError(error);
  }
}
