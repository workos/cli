import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('User');

export async function runUserGet(userId: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const user = await client.sdk.userManagement.getUser(userId);
    outputJson(user);
  } catch (error) {
    handleApiError(error);
  }
}

export interface UserListOptions {
  email?: string;
  organization?: string;
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runUserList(options: UserListOptions, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.userManagement.listUsers({
      email: options.email,
      organizationId: options.organization,
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
      console.log('No users found.');
      return;
    }

    const rows = result.data.map((user) => [
      user.id,
      user.email,
      user.firstName || chalk.dim('-'),
      user.lastName || chalk.dim('-'),
      user.emailVerified ? 'Yes' : 'No',
    ]);

    console.log(
      formatTable(
        [
          { header: 'ID' },
          { header: 'Email' },
          { header: 'First Name' },
          { header: 'Last Name' },
          { header: 'Verified' },
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

export interface UserUpdateOptions {
  firstName?: string;
  lastName?: string;
  emailVerified?: boolean;
  password?: string;
  externalId?: string;
}

export async function runUserUpdate(
  userId: string,
  apiKey: string,
  options: UserUpdateOptions,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const user = await client.sdk.userManagement.updateUser({
      userId,
      ...(options.firstName !== undefined && { firstName: options.firstName }),
      ...(options.lastName !== undefined && { lastName: options.lastName }),
      ...(options.emailVerified !== undefined && { emailVerified: options.emailVerified }),
      ...(options.password !== undefined && { password: options.password }),
      ...(options.externalId !== undefined && { externalId: options.externalId }),
    });
    outputSuccess('Updated user', user);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runUserDelete(userId: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.userManagement.deleteUser(userId);
    outputSuccess('Deleted user', { id: userId });
  } catch (error) {
    handleApiError(error);
  }
}
