/**
 * Unified WorkOS client for CLI commands.
 *
 * Wraps @workos-inc/node SDK for documented endpoints and extends with
 * raw-fetch methods for undocumented/write-only endpoints (webhooks, redirect URIs, etc.).
 * Commands import one client; they don't care whether a method is SDK-backed or raw fetch.
 */

import { WorkOS } from '@workos-inc/node';
import { workosRequest, type WorkOSListResponse } from './workos-api.js';
import { resolveApiKey, resolveApiBaseUrl } from './api-key.js';

export interface WebhookEndpoint {
  id: string;
  endpoint_url: string;
  events: string[];
  secret?: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLogAction {
  action: string;
}

export interface AuditLogRetention {
  retention_period_in_days: number;
}

export interface WorkOSCLIClient {
  sdk: WorkOS;
  webhooks: {
    list(): Promise<WorkOSListResponse<WebhookEndpoint>>;
    create(endpointUrl: string, events: string[]): Promise<WebhookEndpoint>;
    delete(id: string): Promise<void>;
  };
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

    webhooks: {
      async list() {
        return workosRequest<WorkOSListResponse<WebhookEndpoint>>({
          method: 'GET',
          path: '/webhook_endpoints',
          apiKey: key,
          baseUrl: base,
        });
      },
      async create(endpointUrl: string, events: string[]) {
        return workosRequest<WebhookEndpoint>({
          method: 'POST',
          path: '/webhook_endpoints',
          apiKey: key,
          baseUrl: base,
          body: { endpoint_url: endpointUrl, events },
        });
      },
      async delete(id: string) {
        await workosRequest<null>({
          method: 'DELETE',
          path: `/webhook_endpoints/${id}`,
          apiKey: key,
          baseUrl: base,
        });
      },
    },

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
  };
}
