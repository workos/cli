/**
 * Unified WorkOS client for the still-REST CLI commands.
 *
 * Wraps @workos-inc/node SDK for documented endpoints and extends with
 * raw-fetch methods for undocumented/write-only endpoints (redirect URIs,
 * CORS origins, audit-log metadata). Commands import one client; they don't
 * care whether a method is SDK-backed or raw fetch.
 *
 * Migrated resource commands (organization, user, ... — see CLAUDE.md) no
 * longer use this client; they run on the dashboard session plane.
 */

import { WorkOS } from '@workos-inc/node';
import { workosRequest, type WorkOSListResponse } from './workos-api.js';
import { resolveApiKey, resolveApiBaseUrl } from './api-key.js';

export interface AuditLogAction {
  action: string;
}

export interface AuditLogRetention {
  retention_period_in_days: number;
}

export interface SsoConnection {
  object: 'connection';
  id: string;
  organization_id: string;
  name: string;
  connection_type: string;
  state: string;
  external_id?: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface WorkOSCLIClient {
  sdk: WorkOS;
  redirectUris: {
    add(uri: string): Promise<{ success: boolean; alreadyExists: boolean }>;
  };
  corsOrigins: {
    add(origin: string): Promise<{ success: boolean; alreadyExists: boolean }>;
  };
  homepageUrl: {
    set(url: string): Promise<void>;
  };
  auditLogs: {
    listActions(): Promise<WorkOSListResponse<AuditLogAction>>;
    getSchema(action: string): Promise<unknown>;
    getRetention(orgId: string): Promise<AuditLogRetention>;
  };
  connections: {
    create(body: Record<string, unknown>): Promise<SsoConnection>;
    update(id: string, body: Record<string, unknown>): Promise<SsoConnection>;
  };
}

/**
 * Create a unified WorkOS client.
 *
 * @param apiKey  - Explicit API key; falls back to resolveApiKey()
 * @param baseUrl - Explicit base URL; falls back to resolveApiBaseUrl()
 */
export function createWorkOSClient(apiKey?: string, baseUrl?: string): WorkOSCLIClient {
  const key = apiKey ?? resolveApiKey();
  const base = baseUrl ?? resolveApiBaseUrl();

  const url = new URL(base);
  const sdk = new WorkOS(key, {
    apiHostname: url.hostname,
    ...(url.port && { port: Number(url.port) }),
    ...(url.protocol === 'http:' && { https: false }),
  });

  return {
    sdk,

    redirectUris: {
      async add(uri: string) {
        try {
          await workosRequest({
            method: 'POST',
            path: '/user_management/redirect_uris',
            apiKey: key,
            baseUrl: base,
            body: { uri },
          });
          return { success: true, alreadyExists: false };
        } catch (error: unknown) {
          const { WorkOSApiError } = await import('./workos-api.js');
          if (error instanceof WorkOSApiError) {
            if (error.statusCode === 409 || (error.statusCode === 422 && error.message.includes('already exists'))) {
              return { success: true, alreadyExists: true };
            }
          }
          throw error;
        }
      },
    },

    corsOrigins: {
      async add(origin: string) {
        try {
          await workosRequest({
            method: 'POST',
            path: '/user_management/cors_origins',
            apiKey: key,
            baseUrl: base,
            body: { origin },
          });
          return { success: true, alreadyExists: false };
        } catch (error: unknown) {
          const { WorkOSApiError } = await import('./workos-api.js');
          if (error instanceof WorkOSApiError) {
            if (error.statusCode === 409 || (error.statusCode === 422 && error.message.includes('already exists'))) {
              return { success: true, alreadyExists: true };
            }
          }
          throw error;
        }
      },
    },

    homepageUrl: {
      async set(url: string) {
        await workosRequest({
          method: 'PUT',
          path: '/user_management/app_homepage_url',
          apiKey: key,
          baseUrl: base,
          body: { url },
        });
      },
    },

    auditLogs: {
      async listActions() {
        return workosRequest<WorkOSListResponse<AuditLogAction>>({
          method: 'GET',
          path: '/audit_logs/actions',
          apiKey: key,
          baseUrl: base,
        });
      },
      async getSchema(action: string) {
        return workosRequest<unknown>({
          method: 'GET',
          path: `/audit_logs/actions/${encodeURIComponent(action)}/schemas`,
          apiKey: key,
          baseUrl: base,
        });
      },
      async getRetention(orgId: string) {
        return workosRequest<AuditLogRetention>({
          method: 'GET',
          path: `/organizations/${encodeURIComponent(orgId)}/audit_logs_retention`,
          apiKey: key,
          baseUrl: base,
        });
      },
    },

    connections: {
      async create(body: Record<string, unknown>) {
        return workosRequest<SsoConnection>({
          method: 'POST',
          path: '/connections',
          apiKey: key,
          baseUrl: base,
          body,
        });
      },
      async update(id: string, body: Record<string, unknown>) {
        return workosRequest<SsoConnection>({
          method: 'PATCH',
          path: `/connections/${encodeURIComponent(id)}`,
          apiKey: key,
          baseUrl: base,
          body,
        });
      },
    },
  };
}
