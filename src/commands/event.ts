import chalk from 'chalk';
import type { EventName } from '@workos-inc/node';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('Event');

export interface EventListOptions {
  events: string[];
  after?: string;
  organizationId?: string;
  rangeStart?: string;
  rangeEnd?: string;
  limit?: number;
}

export async function runEventList(options: EventListOptions, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.events.listEvents({
      events: options.events as EventName[],
      ...(options.after && { after: options.after }),
      ...(options.organizationId && { organizationId: options.organizationId }),
      ...(options.rangeStart && { rangeStart: options.rangeStart }),
      ...(options.rangeEnd && { rangeEnd: options.rangeEnd }),
      ...(options.limit && { limit: options.limit }),
    });

    if (isJsonMode()) {
      outputJson({ data: result.data, listMetadata: result.listMetadata });
      return;
    }

    if (result.data.length === 0) {
      console.log('No events found.');
      return;
    }

    const rows = result.data.map((event) => [event.id, event.event, event.createdAt]);

    console.log(formatTable([{ header: 'ID' }, { header: 'Event Type' }, { header: 'Created At' }], rows));

    const { before, after } = result.listMetadata;
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
