import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode, exitWithError } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';
import { isCiMode, isPromptAllowed } from '../utils/interaction-mode.js';
import clack from '../utils/clack.js';

const handleApiError = createApiErrorHandler('Directory');

export interface DirectoryListOptions {
  organizationId?: string;
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runDirectoryList(options: DirectoryListOptions, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.directorySync.listDirectories({
      ...(options.organizationId && { organizationId: options.organizationId }),
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
      console.log('No directories found.');
      return;
    }

    const rows = result.data.map((dir) => [
      dir.id,
      dir.name,
      dir.type,
      dir.organizationId || chalk.dim('-'),
      dir.state,
      dir.createdAt,
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

export async function runDirectoryGet(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const directory = await client.sdk.directorySync.getDirectory(id);
    outputJson(directory);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runDirectoryDelete(
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

    const confirmed = await clack.confirm({
      message: `Delete directory ${id}? This cannot be undone.`,
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      console.log('Delete cancelled.');
      return;
    }
  }

  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.directorySync.deleteDirectory(id);
    outputSuccess('Deleted directory', { id });
  } catch (error) {
    handleApiError(error);
  }
}

export interface DirectoryListUsersOptions {
  directory?: string;
  group?: string;
  limit?: number;
  before?: string;
  after?: string;
}

export async function runDirectoryListUsers(
  options: DirectoryListUsersOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  if (!options.directory && !options.group) {
    exitWithError({
      code: 'missing_args',
      message: 'Either --directory or --group is required.',
    });
  }

  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.directorySync.listUsers({
      ...(options.directory && { directory: options.directory }),
      ...(options.group && { group: options.group }),
      limit: options.limit,
      before: options.before,
      after: options.after,
    });

    if (isJsonMode()) {
      outputJson({ data: result.data, listMetadata: result.listMetadata });
      return;
    }

    if (result.data.length === 0) {
      console.log('No directory users found.');
      return;
    }

    const rows = result.data.map((user) => [
      user.id,
      user.email || chalk.dim('-'),
      user.firstName || chalk.dim('-'),
      user.lastName || chalk.dim('-'),
      user.state,
    ]);

    console.log(
      formatTable(
        [{ header: 'ID' }, { header: 'Email' }, { header: 'First Name' }, { header: 'Last Name' }, { header: 'State' }],
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

export interface DirectoryListGroupsOptions {
  directory: string;
  limit?: number;
  before?: string;
  after?: string;
}

export async function runDirectoryListGroups(
  options: DirectoryListGroupsOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.directorySync.listGroups({
      directory: options.directory,
      limit: options.limit,
      before: options.before,
      after: options.after,
    });

    if (isJsonMode()) {
      outputJson({ data: result.data, listMetadata: result.listMetadata });
      return;
    }

    if (result.data.length === 0) {
      console.log('No directory groups found.');
      return;
    }

    const rows = result.data.map((group) => [group.id, group.name, group.createdAt]);

    console.log(formatTable([{ header: 'ID' }, { header: 'Name' }, { header: 'Created' }], rows));

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
