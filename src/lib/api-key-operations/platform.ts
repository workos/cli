/**
 * API-key adapters for `workos webhook`, `workos event`, `workos portal` and
 * `workos feature-flag`, backed by `/webhook_endpoints`, `/events`,
 * `/portal/generate_link` and `/feature-flags`.
 *
 * No REST source, returned `null`: an event's `updatedAt`, a portal link's
 * `id`/`state`/`expiresAt`, and a flag's `accessType` and target lists (the
 * REST flag endpoints expose neither).
 */

import type { WorkOSListResponse } from '../workos-api.js';
import { API_KEY_ENVIRONMENT_ID } from '../resource-auth.js';
import { enumOut } from '../../utils/output-conventions.js';
import {
  type ApiKeyContext,
  type ApiKeyOperation,
  encode,
  listEnvelope,
  num,
  orNull,
  restOrder,
  str,
} from './context.js';

interface RestWebhookEndpoint {
  object?: 'webhook_endpoint';
  id: string;
  endpoint_url: string;
  events?: string[];
  status?: string | null;
  created_at?: string;
}

interface RestEvent {
  object?: 'event';
  id: string;
  event: string;
  data?: unknown;
  created_at?: string;
}

interface RestFlag {
  object?: 'feature_flag';
  id: string;
  slug: string;
  name?: string | null;
  description?: string | null;
  tags?: string[];
  enabled?: boolean;
  default_value?: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * REST endpoint status → the dashboard's `WebhookEndpointState` (`Active` /
 * `InActive`, per the vendored catalog), so `enumOut` yields the same
 * `active` / `in_active` on both paths.
 */
const WEBHOOK_STATE: Record<string, string> = { enabled: 'Active', disabled: 'InActive' };

function webhookState(status: string | null | undefined): string | null {
  if (!status) return null;
  return WEBHOOK_STATE[status] ?? status;
}

/** Flag environment IDs handed out by the flag reads → slug, for the update that follows. */
const flagSlugs = new Map<string, string>();

function flagNode(flag: RestFlag, detail: boolean) {
  // The key is the environment, so the one environment state is the flag's own.
  flagSlugs.set(flag.id, flag.slug);
  const state = {
    id: flag.id,
    environmentId: API_KEY_ENVIRONMENT_ID,
    flagId: flag.id,
    flagEnabled: flag.enabled ?? false,
    ...(detail
      ? {
          defaultEnabled: flag.default_value ?? false,
          accessType: null,
          organizations: null,
          users: null,
          // REST can't list a flag's targets; the shape reports them as unknown.
          targetsUnknown: true,
        }
      : {}),
  };
  return {
    id: flag.id,
    name: flag.name ?? null,
    slug: flag.slug,
    description: flag.description ?? null,
    flagEnvironments: [state],
    createdAt: flag.created_at ?? null,
    updatedAt: flag.updated_at ?? null,
    tags: (flag.tags ?? []).map((tag) => ({ id: null, name: tag })),
  };
}

export const platformOperations: Record<string, ApiKeyOperation> = {
  // --- webhook ------------------------------------------------------------------

  async webhookEndpoints(variables, ctx) {
    const page = await ctx.request<WorkOSListResponse<RestWebhookEndpoint>>({
      method: 'GET',
      path: '/webhook_endpoints',
      params: {
        limit: num(variables.limit),
        before: str(variables.before),
        after: str(variables.after),
        order: restOrder(),
      },
    });
    const endpoints = (page?.data ?? []).map((endpoint) => ({
      id: endpoint.id,
      endpointUrl: endpoint.endpoint_url ?? null,
      events: endpoint.events ?? [],
      state: webhookState(endpoint.status),
      createdAt: endpoint.created_at ?? null,
    }));
    return { webhookEndpoints: listEnvelope(endpoints, page?.list_metadata) };
  },

  async createWebhookEndpoint(variables, ctx) {
    const endpoint = await ctx.request<RestWebhookEndpoint>({
      method: 'POST',
      path: '/webhook_endpoints',
      body: { endpoint_url: variables.endpointUrl, events: variables.events },
    });
    return { createWebhookEndpoint: { id: endpoint.id } };
  },

  async deleteWebhookEndpoint(variables, ctx) {
    await ctx.request({ method: 'DELETE', path: `/webhook_endpoints/${encode(String(variables.id))}` });
    return { deleteWebhookEndpoint: true };
  },

  // --- event --------------------------------------------------------------------

  async environmentEvents(variables, ctx) {
    // Newest-first like the dashboard feed. The command passes its `--after`
    // as `before` and swaps the returned cursors, so the next-page (older)
    // cursor goes back as `before`.
    const page = await ctx.request<WorkOSListResponse<RestEvent>>({
      method: 'GET',
      path: '/events',
      params: {
        events: Array.isArray(variables.names) ? variables.names.join(',') : undefined,
        range_start: str(variables.rangeStart),
        range_end: str(variables.rangeEnd),
        limit: num(variables.limit),
        after: str(variables.before),
        order: 'desc',
      },
    });
    const events = (page?.data ?? []).map((event) => ({
      id: event.id,
      name: event.event ?? null,
      data: event.data ?? null,
      createdAt: event.created_at ?? null,
      updatedAt: null,
    }));
    return {
      environment: {
        events: listEnvelope(events, {
          before: page?.list_metadata?.after ?? null,
          after: page?.list_metadata?.before ?? null,
        }),
      },
    };
  },

  // --- portal -------------------------------------------------------------------

  async generatePortalSetupLink(variables, ctx) {
    const input = (variables.input ?? {}) as { organizationId?: string; intents?: string[] };
    const intent = input.intents?.[0];
    const result = await orNull(
      ctx.request<{ link: string }>({
        method: 'POST',
        path: '/portal/generate_link',
        body: { organization: input.organizationId, intent: enumOut(intent) },
      }),
    );
    if (!result) {
      return { generatePortalSetupLink: { __typename: 'OrganizationNotFound', organizationId: input.organizationId } };
    }
    return {
      generatePortalSetupLink: {
        __typename: 'PortalSetupLinkGenerated',
        // The link is for exactly the intent requested.
        portalSetupLink: { id: null, url: result.link, intents: intent ? [intent] : [], state: null, expiresAt: null },
      },
    };
  },

  // --- feature-flag -------------------------------------------------------------

  async flags(variables, ctx) {
    const page = await ctx.request<WorkOSListResponse<RestFlag>>({
      method: 'GET',
      path: '/feature-flags',
      params: {
        limit: num(variables.limit),
        before: str(variables.before),
        after: str(variables.after),
        order: restOrder(variables.order),
      },
    });
    return {
      flagsForProject: listEnvelope(
        (page?.data ?? []).map((flag) => flagNode(flag, false)),
        page?.list_metadata,
      ),
    };
  },

  async flagBySlug(variables, ctx) {
    const flag = await orNull(
      ctx.request<RestFlag>({ method: 'GET', path: `/feature-flags/${encode(String(variables.slug))}` }),
    );
    return { flagBySlug: flag ? flagNode(flag, true) : null };
  },

  async updateFlagEnvironment(variables, ctx) {
    // Only enable/disable reach here on the API-key path; targets use the
    // REST target endpoints directly (see `changeFlagTarget`).
    const input = (variables.input ?? {}) as { flagEnvironmentId?: string; flagEnabled?: boolean };
    const slug = input.flagEnvironmentId ? flagSlugs.get(input.flagEnvironmentId) : undefined;
    if (!slug) {
      return {
        updateFlagEnvironment: { __typename: 'FlagEnvironmentNotFound', flagEnvironmentId: input.flagEnvironmentId },
      };
    }
    const flag = await orNull(
      ctx.request<RestFlag>({
        method: 'PUT',
        path: `/feature-flags/${encode(slug)}/${input.flagEnabled ? 'enable' : 'disable'}`,
      }),
    );
    if (flag === null) {
      return {
        updateFlagEnvironment: { __typename: 'FlagEnvironmentNotFound', flagEnvironmentId: input.flagEnvironmentId },
      };
    }
    return {
      updateFlagEnvironment: {
        __typename: 'FlagEnvironmentUpdated',
        flagEnvironment: { id: input.flagEnvironmentId, flagEnabled: input.flagEnabled ?? false },
      },
    };
  },
};

/**
 * Add or remove one feature-flag target with an API key. REST can't list a
 * flag's targets, so this skips the dashboard path's read-merge-write and
 * calls the target endpoint directly. Returns `false` when REST reports the
 * flag (or, on removal, the target) as not found.
 */
export async function changeFlagTarget(
  ctx: ApiKeyContext,
  slug: string,
  targetId: string,
  action: 'add' | 'remove',
): Promise<boolean> {
  const result = await orNull(
    ctx
      .request({
        method: action === 'add' ? 'POST' : 'DELETE',
        path: `/feature-flags/${encode(slug)}/targets/${encode(targetId)}`,
      })
      .then(() => true),
  );
  return result === true;
}
