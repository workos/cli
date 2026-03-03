import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('Role');

export async function runRoleList(orgId: string | undefined, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = orgId
      ? await client.sdk.authorization.listOrganizationRoles(orgId)
      : await client.sdk.authorization.listEnvironmentRoles();

    if (isJsonMode()) {
      outputJson({ data: result.data });
      return;
    }

    if (result.data.length === 0) {
      console.log('No roles found.');
      return;
    }

    const rows = result.data.map((role) => [
      role.slug,
      role.name,
      role.type,
      String(role.permissions.length),
      new Date(role.createdAt).toLocaleDateString(),
    ]);

    console.log(
      formatTable(
        [{ header: 'Slug' }, { header: 'Name' }, { header: 'Type' }, { header: 'Permissions' }, { header: 'Created' }],
        rows,
      ),
    );
  } catch (error) {
    handleApiError(error);
  }
}

export async function runRoleGet(
  slug: string,
  orgId: string | undefined,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const role = orgId
      ? await client.sdk.authorization.getOrganizationRole(orgId, slug)
      : await client.sdk.authorization.getEnvironmentRole(slug);
    outputJson(role);
  } catch (error) {
    handleApiError(error);
  }
}

export interface RoleCreateOptions {
  slug: string;
  name: string;
  description?: string;
}

export async function runRoleCreate(
  options: RoleCreateOptions,
  orgId: string | undefined,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  const opts = {
    slug: options.slug,
    name: options.name,
    ...(options.description && { description: options.description }),
  };

  try {
    const role = orgId
      ? await client.sdk.authorization.createOrganizationRole(orgId, opts)
      : await client.sdk.authorization.createEnvironmentRole(opts);
    outputSuccess('Created role', role);
  } catch (error) {
    handleApiError(error);
  }
}

export interface RoleUpdateOptions {
  name?: string;
  description?: string;
}

export async function runRoleUpdate(
  slug: string,
  options: RoleUpdateOptions,
  orgId: string | undefined,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  const opts = {
    ...(options.name !== undefined && { name: options.name }),
    ...(options.description !== undefined && { description: options.description }),
  };

  try {
    const role = orgId
      ? await client.sdk.authorization.updateOrganizationRole(orgId, slug, opts)
      : await client.sdk.authorization.updateEnvironmentRole(slug, opts);
    outputSuccess('Updated role', role);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runRoleDelete(slug: string, orgId: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.authorization.deleteOrganizationRole(orgId, slug);
    outputSuccess('Deleted role', { slug, organizationId: orgId });
  } catch (error) {
    handleApiError(error);
  }
}

export async function runRoleSetPermissions(
  slug: string,
  permissions: string[],
  orgId: string | undefined,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const role = orgId
      ? await client.sdk.authorization.setOrganizationRolePermissions(orgId, slug, { permissions })
      : await client.sdk.authorization.setEnvironmentRolePermissions(slug, { permissions });
    outputSuccess('Set permissions on role', role);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runRoleAddPermission(
  slug: string,
  permissionSlug: string,
  orgId: string | undefined,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const role = orgId
      ? await client.sdk.authorization.addOrganizationRolePermission(orgId, slug, { permissionSlug })
      : await client.sdk.authorization.addEnvironmentRolePermission(slug, { permissionSlug });
    outputSuccess('Added permission to role', role);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runRoleRemovePermission(
  slug: string,
  permissionSlug: string,
  orgId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.authorization.removeOrganizationRolePermission(orgId, slug, { permissionSlug });
    outputSuccess('Removed permission from role', { slug, permissionSlug, organizationId: orgId });
  } catch (error) {
    handleApiError(error);
  }
}
