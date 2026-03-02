import { createWorkOSClient } from '../lib/workos-client.js';
import { outputSuccess, outputJson } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('OrganizationDomain');

export async function runOrgDomainGet(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.organizationDomains.get(id);
    outputJson(result);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runOrgDomainCreate(
  domain: string,
  organizationId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.organizationDomains.create({ domain, organizationId });
    outputSuccess('Created organization domain', result);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runOrgDomainVerify(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.organizationDomains.verify(id);
    outputSuccess('Verified organization domain', result);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runOrgDomainDelete(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.organizationDomains.delete(id);
    outputSuccess('Deleted organization domain', { id });
  } catch (error) {
    handleApiError(error);
  }
}
