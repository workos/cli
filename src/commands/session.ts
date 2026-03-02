import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('Session');

export interface SessionListOptions {
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runSessionList(
  userId: string,
  options: SessionListOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.userManagement.listSessions(userId, {
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
      console.log('No sessions found.');
      return;
    }

    const rows = result.data.map((s) => [
      s.id,
      s.userAgent ?? chalk.dim('-'),
      s.ipAddress ?? chalk.dim('-'),
      s.createdAt,
      s.expiresAt,
    ]);

    console.log(
      formatTable(
        [
          { header: 'ID' },
          { header: 'User Agent' },
          { header: 'IP Address' },
          { header: 'Created' },
          { header: 'Expires' },
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

export async function runSessionRevoke(sessionId: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.userManagement.revokeSession({ sessionId });
    outputSuccess('Revoked session', { id: sessionId });
  } catch (error) {
    handleApiError(error);
  }
}
