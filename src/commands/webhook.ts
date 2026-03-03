import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputJson, outputSuccess, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('Webhook');

export async function runWebhookList(apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.webhooks.list();

    if (isJsonMode()) {
      // Normalize snake_case list_metadata to camelCase for consistent CLI output
      outputJson({
        data: result.data,
        listMetadata: {
          before: result.list_metadata.before,
          after: result.list_metadata.after,
        },
      });
      return;
    }

    if (result.data.length === 0) {
      console.log('No webhook endpoints found.');
      return;
    }

    const rows = result.data.map((ep) => [ep.id, ep.url, ep.events.join(', '), ep.created_at]);

    console.log(formatTable([{ header: 'ID' }, { header: 'URL' }, { header: 'Events' }, { header: 'Created' }], rows));

    const { before, after } = result.list_metadata;
    if (before && after) {
      console.log(chalk.dim(`Before: ${before}  After: ${after}`));
    } else if (before) {
      console.log(chalk.dim(`Before: ${before}`));
    } else if (after) {
      console.log(chalk.dim(`After: ${after}`));
    }
  } catch (error) {
    handleApiError(error);
  }
}

export async function runWebhookCreate(url: string, events: string[], apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const endpoint = await client.webhooks.create(url, events);

    if (isJsonMode()) {
      outputJson({ status: 'ok', message: 'Created webhook endpoint', data: endpoint });
      return;
    }

    console.log(chalk.green('Created webhook endpoint'));
    console.log(JSON.stringify(endpoint, null, 2));
    if (endpoint.secret) {
      console.log('');
      console.log(chalk.yellow('Signing secret: ') + endpoint.secret);
      console.log(chalk.yellow('Save this secret now — it will not be shown again.'));
    }
  } catch (error) {
    handleApiError(error);
  }
}

export async function runWebhookDelete(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.webhooks.delete(id);
    outputSuccess('Deleted webhook endpoint', { id });
  } catch (error) {
    handleApiError(error);
  }
}
