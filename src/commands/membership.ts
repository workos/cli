import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode, exitWithError } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('Membership');

export interface MembershipListOptions {
  org?: string;
  user?: string;
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runMembershipList(
  options: MembershipListOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  if (!options.org && !options.user) {
    exitWithError({
      code: 'missing_args',
      message: 'At least one of --org or --user is required.',
    });
  }

  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.userManagement.listOrganizationMemberships({
      ...(options.org && { organizationId: options.org }),
      ...(options.user && { userId: options.user }),
      limit: options.limit,
      before: options.before,
      after: options.after,
      order: options.order as 'asc' | 'desc' | undefined,
    } as Parameters<typeof client.sdk.userManagement.listOrganizationMemberships>[0]);

    if (isJsonMode()) {
      outputJson({ data: result.data, listMetadata: result.listMetadata });
      return;
    }

    if (result.data.length === 0) {
      console.log('No memberships found.');
      return;
    }

    const rows = result.data.map((m) => [
      m.id,
      m.userId,
      m.organizationId,
      m.role?.slug ?? chalk.dim('-'),
      m.status,
      m.createdAt,
    ]);

    console.log(
      formatTable(
        [
          { header: 'ID' },
          { header: 'User ID' },
          { header: 'Org ID' },
          { header: 'Role' },
          { header: 'Status' },
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

export async function runMembershipGet(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const membership = await client.sdk.userManagement.getOrganizationMembership(id);
    outputJson(membership);
  } catch (error) {
    handleApiError(error);
  }
}

export interface MembershipCreateOptions {
  org: string;
  user: string;
  role?: string;
}

export async function runMembershipCreate(
  options: MembershipCreateOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const membership = await client.sdk.userManagement.createOrganizationMembership({
      organizationId: options.org,
      userId: options.user,
      ...(options.role && { roleSlug: options.role }),
    });
    outputSuccess('Created membership', membership);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runMembershipUpdate(
  id: string,
  role: string | undefined,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const membership = await client.sdk.userManagement.updateOrganizationMembership(id, {
      ...(role && { roleSlug: role }),
    });
    outputSuccess('Updated membership', membership);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runMembershipDelete(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.userManagement.deleteOrganizationMembership(id);
    outputSuccess('Deleted membership', { id });
  } catch (error) {
    handleApiError(error);
  }
}

export async function runMembershipDeactivate(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const membership = await client.sdk.userManagement.deactivateOrganizationMembership(id);
    outputSuccess('Deactivated membership', membership);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runMembershipReactivate(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const membership = await client.sdk.userManagement.reactivateOrganizationMembership(id);
    outputSuccess('Reactivated membership', membership);
  } catch (error) {
    handleApiError(error);
  }
}
