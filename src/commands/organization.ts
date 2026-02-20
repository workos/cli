import chalk from 'chalk';
import { workosRequest, WorkOSApiError } from '../lib/workos-api.js';
import type { WorkOSListResponse } from '../lib/workos-api.js';
import { formatTable } from '../utils/table.js';

interface OrganizationDomain {
  id: string;
  domain: string;
  state: 'verified' | 'pending';
}

interface Organization {
  id: string;
  name: string;
  domains: OrganizationDomain[];
  created_at: string;
  updated_at: string;
}

interface DomainData {
  domain: string;
  state: string;
}

export function parseDomainArgs(args: string[]): DomainData[] {
  return args.map((arg) => {
    const parts = arg.split(':');
    return {
      domain: parts[0],
      state: parts[1] || 'verified',
    };
  });
}

function handleApiError(error: unknown): never {
  if (error instanceof WorkOSApiError) {
    if (error.statusCode === 401) {
      console.error(chalk.red('Invalid API key. Check your environment configuration.'));
    } else if (error.statusCode === 404) {
      console.error(chalk.red(`Organization not found.`));
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

export async function runOrgCreate(
  name: string,
  domainArgs: string[],
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const body: Record<string, unknown> = { name };
  const domains = parseDomainArgs(domainArgs);
  if (domains.length > 0) {
    body.domain_data = domains;
  }

  try {
    const org = await workosRequest<Organization>({
      method: 'POST',
      path: '/organizations',
      apiKey,
      baseUrl,
      body,
    });
    console.log(chalk.green('Created organization'));
    console.log(JSON.stringify(org, null, 2));
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
  const body: Record<string, unknown> = { name };
  if (domain) {
    body.domain_data = [{ domain, state: state || 'verified' }];
  }

  try {
    const org = await workosRequest<Organization>({
      method: 'PUT',
      path: `/organizations/${orgId}`,
      apiKey,
      baseUrl,
      body,
    });
    console.log(chalk.green('Updated organization'));
    console.log(JSON.stringify(org, null, 2));
  } catch (error) {
    handleApiError(error);
  }
}

export async function runOrgGet(orgId: string, apiKey: string, baseUrl?: string): Promise<void> {
  try {
    const org = await workosRequest<Organization>({
      method: 'GET',
      path: `/organizations/${orgId}`,
      apiKey,
      baseUrl,
    });
    console.log(JSON.stringify(org, null, 2));
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
  try {
    const result = await workosRequest<WorkOSListResponse<Organization>>({
      method: 'GET',
      path: '/organizations',
      apiKey,
      baseUrl,
      params: {
        domains: options.domain,
        limit: options.limit,
        before: options.before,
        after: options.after,
        order: options.order,
      },
    });

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

export async function runOrgDelete(orgId: string, apiKey: string, baseUrl?: string): Promise<void> {
  try {
    await workosRequest({
      method: 'DELETE',
      path: `/organizations/${orgId}`,
      apiKey,
      baseUrl,
    });
    console.log(chalk.green(`Deleted organization ${orgId}`));
  } catch (error) {
    handleApiError(error);
  }
}
