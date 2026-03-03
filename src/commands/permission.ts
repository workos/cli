import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('Permission');

export interface PermissionListOptions {
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runPermissionList(
  options: PermissionListOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.authorization.listPermissions({
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
      console.log('No permissions found.');
      return;
    }

    const rows = result.data.map((perm) => [
      perm.slug,
      perm.name,
      perm.description || chalk.dim('-'),
      new Date(perm.createdAt).toLocaleDateString(),
    ]);

    console.log(
      formatTable([{ header: 'Slug' }, { header: 'Name' }, { header: 'Description' }, { header: 'Created' }], rows),
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

export async function runPermissionGet(slug: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const permission = await client.sdk.authorization.getPermission(slug);
    outputJson(permission);
  } catch (error) {
    handleApiError(error);
  }
}

export interface PermissionCreateOptions {
  slug: string;
  name: string;
  description?: string;
}

export async function runPermissionCreate(
  options: PermissionCreateOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const permission = await client.sdk.authorization.createPermission({
      slug: options.slug,
      name: options.name,
      ...(options.description && { description: options.description }),
    });
    outputSuccess('Created permission', permission);
  } catch (error) {
    handleApiError(error);
  }
}

export interface PermissionUpdateOptions {
  name?: string;
  description?: string;
}

export async function runPermissionUpdate(
  slug: string,
  options: PermissionUpdateOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const permission = await client.sdk.authorization.updatePermission(slug, {
      ...(options.name !== undefined && { name: options.name }),
      ...(options.description !== undefined && { description: options.description }),
    });
    outputSuccess('Updated permission', permission);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runPermissionDelete(slug: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.authorization.deletePermission(slug);
    outputSuccess('Deleted permission', { slug });
  } catch (error) {
    handleApiError(error);
  }
}
