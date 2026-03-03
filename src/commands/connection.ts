import chalk from 'chalk';
import type { ConnectionType } from '@workos-inc/node';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode, exitWithError } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';
import { isNonInteractiveEnvironment } from '../utils/environment.js';
import clack from '../utils/clack.js';

const handleApiError = createApiErrorHandler('Connection');

export interface ConnectionListOptions {
  organizationId?: string;
  connectionType?: string;
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runConnectionList(
  options: ConnectionListOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.sso.listConnections({
      ...(options.organizationId && { organizationId: options.organizationId }),
      ...(options.connectionType && { connectionType: options.connectionType as ConnectionType }),
      limit: options.limit,
      before: options.before,
      after: options.after,
      order: options.order as 'asc' | 'desc' | undefined,
    });

    if (isJsonMode()) {
      outputJson({ data: result.data, listMetadata: result.listMetadata });
      return;
    }

    if (result.data.length === 0) {
      console.log('No connections found.');
      return;
    }

    const rows = result.data.map((conn) => [
      conn.id,
      conn.name,
      conn.type,
      conn.organizationId || chalk.dim('-'),
      conn.state,
      conn.createdAt,
    ]);

    console.log(
      formatTable(
        [
          { header: 'ID' },
          { header: 'Name' },
          { header: 'Type' },
          { header: 'Org ID' },
          { header: 'State' },
          { header: 'Created' },
        ],
        rows,
      ),
    );

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

export async function runConnectionGet(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const connection = await client.sdk.sso.getConnection(id);
    outputJson(connection);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runConnectionDelete(
  id: string,
  options: { force?: boolean },
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  if (!options.force) {
    if (isNonInteractiveEnvironment()) {
      exitWithError({
        code: 'confirmation_required',
        message: 'Destructive operation requires --force flag in non-interactive mode.',
      });
    }

    const confirmed = await clack.confirm({
      message: `Delete connection ${id}? This cannot be undone.`,
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      console.log('Delete cancelled.');
      return;
    }
  }

  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.sso.deleteConnection(id);
    outputSuccess('Deleted connection', { id });
  } catch (error) {
    handleApiError(error);
  }
}
