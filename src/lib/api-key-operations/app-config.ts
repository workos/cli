/**
 * API-key adapters for AuthKit app configuration (`workos config`, `workos
 * authkit redirect-uris|cors`), backed by `/user_management/redirect_uris`,
 * `/user_management/cors_origins` and `/user_management/app_homepage_url`.
 *
 * The dashboard setters replace whole lists; REST has per-item endpoints. A
 * list "set" becomes a diff: create what's missing first, then delete what's
 * dropped, so a failure part-way never leaves fewer working URIs than before.
 * Where REST lacks a piece, the request fails before any write: there is no
 * delete for CORS origins, no way to choose the default redirect URI, and no
 * validate-only (`--dry-run`) mode.
 */

import {
  type ApiKeyContext,
  type ApiKeyOperation,
  encode,
  exitApiKeyUnsupported,
  listAll,
  listEnvelope,
  num,
  str,
} from './context.js';
import type { WorkOSListResponse } from '../workos-api.js';

interface RestRedirectUri {
  object?: 'redirect_uri';
  id: string;
  uri: string;
  default?: boolean;
}

interface RestCorsOrigin {
  object?: 'cors_origin';
  id: string;
  origin: string;
}

function redirectUriNode(uri: RestRedirectUri) {
  return { id: uri.id, uri: uri.uri, isDefault: uri.default ?? false };
}

function refuseDryRun(dryRun: unknown): void {
  if (dryRun) exitApiKeyUnsupported('--dry-run has no validate-only equivalent in the WorkOS API');
}

function corsOrigins(ctx: ApiKeyContext): Promise<RestCorsOrigin[]> {
  return listAll<RestCorsOrigin>(ctx, '/user_management/cors_origins');
}

export const appConfigOperations: Record<string, ApiKeyOperation> = {
  async redirectUris(variables, ctx) {
    const page = await ctx.request<WorkOSListResponse<RestRedirectUri>>({
      method: 'GET',
      path: '/user_management/redirect_uris',
      params: { limit: num(variables.limit), before: str(variables.before), after: str(variables.after) },
    });
    return { redirectUris: listEnvelope((page?.data ?? []).map(redirectUriNode), page?.list_metadata) };
  },

  async setRedirectUris(variables, ctx) {
    const input = (variables.input ?? {}) as {
      redirectUris?: Array<{ uri: string; isDefault?: boolean }>;
      dryRun?: boolean;
    };
    refuseDryRun(input.dryRun);
    const desired = input.redirectUris ?? [];
    const current = await listAll<RestRedirectUri>(ctx, '/user_management/redirect_uris');

    // REST can't choose the default: only an already-default URI may be marked default.
    const wantsNewDefault = desired.some(
      (entry) => entry.isDefault && !current.some((existing) => existing.uri === entry.uri && existing.default),
    );
    if (wantsNewDefault) {
      exitApiKeyUnsupported('choosing the default redirect URI has no WorkOS API endpoint');
    }

    // Add before removing: if a new URI is rejected or a request fails, the
    // working URIs are all still in place (at worst an extra one remains),
    // so a failed replace can't break sign-in.
    for (const entry of desired) {
      if (!current.some((existing) => existing.uri === entry.uri)) {
        await ctx.request({ method: 'POST', path: '/user_management/redirect_uris', body: { uri: entry.uri } });
      }
    }
    const desiredUris = new Set(desired.map((entry) => entry.uri));
    for (const existing of current) {
      if (!desiredUris.has(existing.uri)) {
        await ctx.request({ method: 'DELETE', path: `/user_management/redirect_uris/${encode(existing.id)}` });
      }
    }

    const saved = await listAll<RestRedirectUri>(ctx, '/user_management/redirect_uris');
    return { setRedirectUris: { __typename: 'RedirectUrisSet', redirectUris: saved.map(redirectUriNode) } };
  },

  async corsConfig(_variables, ctx) {
    const origins = await corsOrigins(ctx);
    return { webOrigins: { webOrigins: { origins: origins.map((origin) => origin.origin) } } };
  },

  async updateCorsConfig(variables, ctx) {
    refuseDryRun(variables.dryRun);
    const desired = Array.isArray(variables.origins) ? variables.origins.map(String) : [];
    const current = (await corsOrigins(ctx)).map((origin) => origin.origin);

    const removed = current.filter((origin) => !desired.includes(origin));
    if (removed.length > 0) {
      exitApiKeyUnsupported(`removing CORS origins (${removed.join(', ')}) has no WorkOS API endpoint`);
    }
    for (const origin of desired) {
      if (!current.includes(origin)) {
        await ctx.request({ method: 'POST', path: '/user_management/cors_origins', body: { origin } });
      }
    }

    const saved = (await corsOrigins(ctx)).map((origin) => origin.origin);
    return { setWebOrigins: { __typename: 'WebOriginsSet', origins: saved } };
  },
};

/**
 * Set the AuthKit homepage URL with an API key. The key's environment has one
 * AuthKit application, which REST updates without exposing its ID.
 */
export async function setHomepageUrl(ctx: ApiKeyContext, url: string): Promise<void> {
  await ctx.request({ method: 'PUT', path: '/user_management/app_homepage_url', body: { url } });
}
