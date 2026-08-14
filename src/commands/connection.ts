import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import type { ConnectionType } from '@workos-inc/node';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { printPaginationFooter } from '../utils/resource-command.js';
import { outputSuccess, outputJson, isJsonMode, exitWithError } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';
import { isCiMode, isPromptAllowed } from '../utils/interaction-mode.js';
import ui from '../utils/ui.js';

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

    printPaginationFooter(result.listMetadata);
  } catch (error) {
    handleApiError(error);
  }
}

export interface ConnectionBodyOptions {
  org?: string;
  name?: string;
  externalId?: string;
  type?: string;
  data?: string;
  file?: string;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function resolveConnectionBody(options: ConnectionBodyOptions): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};

  let raw: string | undefined;
  if (options.data !== undefined) {
    raw = options.data;
  } else if (options.file) {
    if (options.file === '-') {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks).toString('utf-8');
      if (raw.length === 0) {
        exitWithError({
          code: 'empty_stdin_body',
          message:
            'Reading request body from stdin (--file -) yielded no data. Pipe data into the command or pass --data instead.',
        });
      }
    } else {
      try {
        raw = await readFile(options.file, 'utf-8');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        exitWithError({
          code: 'file_read_error',
          message: `Could not read request body file "${options.file}": ${message}`,
        });
      }
    }
  }

  if (raw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      exitWithError({
        code: 'invalid_json_body',
        message: 'Request body must be valid JSON.',
      });
    }
    if (!isJsonObject(parsed)) {
      exitWithError({
        code: 'invalid_json_body',
        message: 'Request body must be a JSON object.',
      });
    }
    body = { ...parsed };
  }

  if (options.org !== undefined) body.organization_id = options.org;
  if (options.name !== undefined) body.name = options.name;
  if (options.externalId !== undefined) body.external_id = options.externalId;
  if (options.type !== undefined) body.connection_type = options.type;

  return body;
}

export async function runConnectionCreate(
  options: ConnectionBodyOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const body = await resolveConnectionBody(options);

  if (typeof body.organization_id !== 'string' || body.organization_id.length === 0) {
    exitWithError({
      code: 'missing_organization_id',
      message: 'An organization ID is required. Pass --org or include organization_id in the JSON body.',
    });
  }

  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const connection = await client.connections.create(body);
    outputSuccess('Created connection', connection);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runConnectionUpdate(
  id: string,
  options: ConnectionBodyOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const body = await resolveConnectionBody(options);

  if (Object.keys(body).length === 0) {
    exitWithError({
      code: 'empty_update_body',
      message: 'Nothing to update. Pass at least one field flag, or a JSON body via --data or --file.',
    });
  }

  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const connection = await client.connections.update(id, body);
    outputSuccess('Updated connection', connection);
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
    if (!isPromptAllowed()) {
      exitWithError({
        code: 'confirmation_required',
        message: isCiMode()
          ? 'Destructive operation requires --force flag in CI mode.'
          : 'Destructive operation requires --force flag in agent mode.',
      });
    }

    const confirmed = await ui.confirm({
      message: `Delete connection ${id}? This cannot be undone.`,
    });

    if (ui.isCancel(confirmed) || !confirmed) {
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
