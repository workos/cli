import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('FeatureFlag');

export interface FeatureFlagListOptions {
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runFeatureFlagList(
  options: FeatureFlagListOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.featureFlags.listFeatureFlags({
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
      console.log('No feature flags found.');
      return;
    }

    const rows = result.data.map((flag) => [
      flag.slug,
      flag.name ?? chalk.dim('-'),
      flag.enabled ? chalk.green('Yes') : chalk.red('No'),
      flag.description ?? chalk.dim('-'),
    ]);

    console.log(
      formatTable([{ header: 'Slug' }, { header: 'Name' }, { header: 'Enabled' }, { header: 'Description' }], rows),
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

export async function runFeatureFlagGet(slug: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.featureFlags.getFeatureFlag(slug);
    outputJson(result);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runFeatureFlagEnable(slug: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.featureFlags.enableFeatureFlag(slug);
    outputSuccess('Enabled feature flag', result);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runFeatureFlagDisable(slug: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.featureFlags.disableFeatureFlag(slug);
    outputSuccess('Disabled feature flag', result);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runFeatureFlagAddTarget(
  slug: string,
  targetId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.featureFlags.addFlagTarget({ slug, targetId });
    outputSuccess('Added target to feature flag', { slug, targetId });
  } catch (error) {
    handleApiError(error);
  }
}

export async function runFeatureFlagRemoveTarget(
  slug: string,
  targetId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.featureFlags.removeFlagTarget({ slug, targetId });
    outputSuccess('Removed target from feature flag', { slug, targetId });
  } catch (error) {
    handleApiError(error);
  }
}
