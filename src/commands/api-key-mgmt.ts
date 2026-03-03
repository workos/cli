import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('ApiKey');

export interface ApiKeyListOptions {
  organizationId: string;
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runApiKeyList(options: ApiKeyListOptions, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.organizations.listOrganizationApiKeys({
      organizationId: options.organizationId,
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
      console.log('No API keys found.');
      return;
    }

    const rows = result.data.map((key) => [key.id, key.name, key.obfuscatedValue ?? chalk.dim('-'), key.createdAt]);

    console.log(
      formatTable([{ header: 'ID' }, { header: 'Name' }, { header: 'Obfuscated Value' }, { header: 'Created' }], rows),
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

export interface ApiKeyCreateOptions {
  organizationId: string;
  name: string;
  permissions?: string[];
}

export async function runApiKeyCreate(options: ApiKeyCreateOptions, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.organizations.createOrganizationApiKey({
      organizationId: options.organizationId,
      name: options.name,
      ...(options.permissions && { permissions: options.permissions }),
    });

    if (isJsonMode()) {
      outputJson({ status: 'ok', message: 'Created API key', data: result });
      return;
    }

    console.log(chalk.green('Created API key'));
    console.log(JSON.stringify(result, null, 2));
    if (result.value) {
      console.log('');
      console.log(chalk.yellow('API key value: ') + result.value);
      console.log(chalk.yellow('Save this key now — it will not be shown again.'));
    }
  } catch (error) {
    handleApiError(error);
  }
}

export async function runApiKeyValidate(value: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.apiKeys.validateApiKey({ value });

    if (isJsonMode()) {
      outputJson(result);
      return;
    }

    if (result.apiKey) {
      console.log(chalk.green('API key is valid'));
      console.log(JSON.stringify(result.apiKey, null, 2));
    } else {
      console.log(chalk.red('API key is invalid or not found.'));
    }
  } catch (error) {
    handleApiError(error);
  }
}

export async function runApiKeyDelete(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.apiKeys.deleteApiKey(id);
    outputSuccess('Deleted API key', { id });
  } catch (error) {
    handleApiError(error);
  }
}
