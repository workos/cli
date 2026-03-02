import chalk from 'chalk';
import type { DomainData } from '@workos-inc/node';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

export function parseDomainArgs(args: string[]): DomainData[] {
  return args.map((arg) => {
    const parts = arg.split(':');
    return {
      domain: parts[0],
      state: (parts[1] || 'verified') as DomainData['state'],
    };
  });
}

const handleApiError = createApiErrorHandler('Organization');

export async function runOrgCreate(
  name: string,
  domainArgs: string[],
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);
  const domains = parseDomainArgs(domainArgs);

  try {
    const org = await client.sdk.organizations.createOrganization({
      name,
      ...(domains.length > 0 && { domainData: domains }),
    });
    outputSuccess('Created organization', org);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runOrgUpdate(
  orgId: string,
  name: string,
  apiKey: string,
  domain?: string,
  state?: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const org = await client.sdk.organizations.updateOrganization({
      organization: orgId,
      name,
      ...(domain && { domainData: [{ domain, state: (state || 'verified') as DomainData['state'] }] }),
    });
    outputSuccess('Updated organization', org);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runOrgGet(orgId: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const org = await client.sdk.organizations.getOrganization(orgId);
    outputJson(org);
  } catch (error) {
    handleApiError(error);
  }
}

export interface OrgListOptions {
  domain?: string;
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runOrgList(options: OrgListOptions, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.organizations.listOrganizations({
      ...(options.domain && { domains: [options.domain] }),
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
      console.log('No organizations found.');
      return;
    }

    const rows = result.data.map((org) => [
      org.id,
      org.name,
      org.domains.map((d) => d.domain).join(', ') || chalk.dim('none'),
    ]);

    console.log(formatTable([{ header: 'ID' }, { header: 'Name' }, { header: 'Domains' }], rows));

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

export async function runOrgDelete(orgId: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.organizations.deleteOrganization(orgId);
    outputSuccess('Deleted organization', { id: orgId });
  } catch (error) {
    handleApiError(error);
  }
}
