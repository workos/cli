import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('Invitation');

export interface InvitationListOptions {
  org?: string;
  email?: string;
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runInvitationList(
  options: InvitationListOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.userManagement.listInvitations({
      ...(options.org && { organizationId: options.org }),
      ...(options.email && { email: options.email }),
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
      console.log('No invitations found.');
      return;
    }

    const rows = result.data.map((inv) => [
      inv.id,
      inv.email,
      inv.organizationId ?? chalk.dim('-'),
      inv.state,
      inv.expiresAt,
    ]);

    console.log(
      formatTable(
        [{ header: 'ID' }, { header: 'Email' }, { header: 'Org ID' }, { header: 'State' }, { header: 'Expires At' }],
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

export async function runInvitationGet(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const invitation = await client.sdk.userManagement.getInvitation(id);
    outputJson(invitation);
  } catch (error) {
    handleApiError(error);
  }
}

export interface InvitationSendOptions {
  email: string;
  org?: string;
  role?: string;
  expiresInDays?: number;
}

export async function runInvitationSend(
  options: InvitationSendOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const invitation = await client.sdk.userManagement.sendInvitation({
      email: options.email,
      ...(options.org && { organizationId: options.org }),
      ...(options.role && { roleSlug: options.role }),
      ...(options.expiresInDays !== undefined && { expiresInDays: options.expiresInDays }),
    });
    outputSuccess('Sent invitation', invitation);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runInvitationRevoke(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const invitation = await client.sdk.userManagement.revokeInvitation(id);
    outputSuccess('Revoked invitation', invitation);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runInvitationResend(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const invitation = await client.sdk.userManagement.resendInvitation(id);
    outputSuccess('Resent invitation', invitation);
  } catch (error) {
    handleApiError(error);
  }
}
