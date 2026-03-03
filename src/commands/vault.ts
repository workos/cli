import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('Vault');

export interface VaultListOptions {
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runVaultList(options: VaultListOptions, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.vault.listObjects({
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
      console.log('No vault objects found.');
      return;
    }

    const rows = result.data.map((obj) => [obj.id, obj.name, obj.updatedAt ? String(obj.updatedAt) : chalk.dim('-')]);

    console.log(formatTable([{ header: 'ID' }, { header: 'Name' }, { header: 'Updated At' }], rows));

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

export async function runVaultGet(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.vault.readObject({ id });
    outputJson(result);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runVaultGetByName(name: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.vault.readObjectByName(name);
    outputJson(result);
  } catch (error) {
    handleApiError(error);
  }
}

export interface VaultCreateOptions {
  name: string;
  value: string;
  org?: string;
}

export async function runVaultCreate(options: VaultCreateOptions, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const context = options.org ? { organizationId: options.org } : {};
    const result = await client.sdk.vault.createObject({
      name: options.name,
      value: options.value,
      context,
    });
    outputSuccess('Created vault object', result);
  } catch (error) {
    handleApiError(error);
  }
}

export interface VaultUpdateOptions {
  id: string;
  value: string;
  versionCheck?: string;
}

export async function runVaultUpdate(options: VaultUpdateOptions, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.vault.updateObject({
      id: options.id,
      value: options.value,
      ...(options.versionCheck && { versionCheck: options.versionCheck }),
    });
    outputSuccess('Updated vault object', result);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runVaultDelete(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.vault.deleteObject({ id });
    outputSuccess('Deleted vault object', { id });
  } catch (error) {
    handleApiError(error);
  }
}

export async function runVaultDescribe(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.vault.describeObject({ id });
    outputJson(result);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runVaultListVersions(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.vault.listObjectVersions({ id });
    outputJson(result);
  } catch (error) {
    handleApiError(error);
  }
}
