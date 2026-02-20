import chalk from 'chalk';
import { workosRequest, WorkOSApiError } from '../lib/workos-api.js';
import type { WorkOSListResponse } from '../lib/workos-api.js';
import { formatTable } from '../utils/table.js';

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
}

function handleApiError(error: unknown): never {
  if (error instanceof WorkOSApiError) {
    if (error.statusCode === 401) {
      console.error(chalk.red('Invalid API key. Check your environment configuration.'));
    } else if (error.statusCode === 404) {
      console.error(chalk.red('User not found.'));
    } else if (error.statusCode === 422 && error.errors?.length) {
      console.error(chalk.red(error.errors.map((e) => e.message).join(', ')));
    } else {
      console.error(chalk.red(error.message));
    }
  } else {
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
  }
  process.exit(1);
}

export async function runUserGet(userId: string, apiKey: string, baseUrl?: string): Promise<void> {
  try {
    const user = await workosRequest<User>({
      method: 'GET',
      path: `/user_management/users/${userId}`,
      apiKey,
      baseUrl,
    });
    console.log(JSON.stringify(user, null, 2));
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
  try {
    const result = await workosRequest<WorkOSListResponse<User>>({
      method: 'GET',
      path: '/user_management/users',
      apiKey,
      baseUrl,
      params: {
        email: options.email,
        organization_id: options.organization,
        limit: options.limit,
        before: options.before,
        after: options.after,
        order: options.order,
      },
    });

    if (result.data.length === 0) {
      console.log('No users found.');
      return;
    }

    const rows = result.data.map((user) => [
      user.id,
      user.email,
      user.first_name || chalk.dim('-'),
      user.last_name || chalk.dim('-'),
      user.email_verified ? 'Yes' : 'No',
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
  const body: Record<string, unknown> = {};
  if (options.firstName !== undefined) body.first_name = options.firstName;
  if (options.lastName !== undefined) body.last_name = options.lastName;
  if (options.emailVerified !== undefined) body.email_verified = options.emailVerified;
  if (options.password !== undefined) body.password = options.password;
  if (options.externalId !== undefined) body.external_id = options.externalId;

  try {
    const user = await workosRequest<User>({
      method: 'PUT',
      path: `/user_management/users/${userId}`,
      apiKey,
      baseUrl,
      body,
    });
    console.log(chalk.green('Updated user'));
    console.log(JSON.stringify(user, null, 2));
  } catch (error) {
    handleApiError(error);
  }
}

export async function runUserDelete(userId: string, apiKey: string, baseUrl?: string): Promise<void> {
  try {
    await workosRequest({
      method: 'DELETE',
      path: `/user_management/users/${userId}`,
      apiKey,
      baseUrl,
    });
    console.log(chalk.green(`Deleted user ${userId}`));
  } catch (error) {
    handleApiError(error);
  }
}
