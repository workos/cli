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

    const maxEventsChars = 60;
    const rows = result.data.map((ep) => {
      const joined = ep.events.join(', ');
      if (joined.length <= maxEventsChars) {
        return [ep.id, ep.endpoint_url, joined, ep.created_at];
      }
      // Always include the first event so the cell isn't content-free when a single event name exceeds the budget.
      const visible: string[] = [ep.events[0]];
      let len = ep.events[0].length;
      for (let i = 1; i < ep.events.length; i++) {
        const next = len + 2 + ep.events[i].length;
        if (next > maxEventsChars) break;
        visible.push(ep.events[i]);
        len = next;
      }
      const hidden = ep.events.length - visible.length;
      const suffix = hidden > 0 ? `, … (+${hidden} more)` : '';
      return [ep.id, ep.endpoint_url, `${visible.join(', ')}${suffix}`, ep.created_at];
    });

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
