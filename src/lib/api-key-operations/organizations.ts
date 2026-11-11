/**
 * API-key adapters for `workos organization` and `workos org-domain`, backed by
 * the WorkOS REST API (`/organizations`, `/organization_domains`).
 *
 * Fields the REST API has no source for (`usersCount`, a domain's
 * `subdomain` and `domainCaptureEnabled`) are returned `null` rather than
 * invented. A domain's DNS challenge is kept: REST returns its prefix and
 * token, and `verificationContent` is built from them exactly as the dashboard
 * builds it.
 */

import type { WorkOSListResponse } from '../workos-api.js';
import { type ApiKeyOperation, encode, listEnvelope, num, orNull, restOrder, str } from './context.js';

export interface RestOrganizationDomain {
  object?: 'organization_domain';
  id: string;
  organization_id?: string;
  domain: string;
  state?: string | null;
  verification_strategy?: string | null;
  verification_token?: string | null;
  verification_prefix?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface RestOrganization {
  object?: 'organization';
  id: string;
  name: string;
  domains?: RestOrganizationDomain[];
  metadata?: Record<string, string> | null;
  external_id?: string | null;
  allow_profiles_outside_organization?: boolean;
  stripe_customer_id?: string;
  created_at?: string;
  updated_at?: string;
}

/** Object map → the `[{ key, value }]` pairs the dashboard operation returns. */
export function metadataPairs(metadata: Record<string, string> | null | undefined) {
  return Object.entries(metadata ?? {}).map(([key, value]) => ({ key, value }));
}

/** The dashboard's prefix when a domain has none of its own (`DEFAULT_VERIFICATION_PREFIX`). */
const DEFAULT_VERIFICATION_PREFIX = 'verification_token';

/**
 * The DNS TXT record value for a domain's verification challenge, as the
 * dashboard reports it (`OrganizationDomain.verificationContent`):
 * `<prefix>=<token>`, using the default prefix when the domain has none, and
 * null when there is no token (nothing to verify).
 */
export function verificationContent(domain: RestOrganizationDomain): string | null {
  if (!domain.verification_token) return null;
  return `${domain.verification_prefix ?? DEFAULT_VERIFICATION_PREFIX}=${domain.verification_token}`;
}

/**
 * A REST organization domain in the dashboard `OrganizationDomain` selection.
 * `subdomain` stays null: the dashboard derives it with a public-suffix
 * parser, and REST doesn't return it.
 */
export function domainNode(domain: RestOrganizationDomain) {
  return {
    id: domain.id,
    domain: domain.domain,
    state: domain.state ?? null,
    subdomain: null,
    verificationContent: verificationContent(domain),
    verificationStrategy: domain.verification_strategy ?? null,
  };
}

/** A REST organization in the dashboard `Organization` fragment's selection. */
function organizationNode(org: RestOrganization) {
  return {
    id: org.id,
    name: org.name ?? null,
    createdAt: org.created_at ?? null,
    allowProfilesOutsideOrganization: org.allow_profiles_outside_organization ?? null,
    usersCount: null,
    externalId: org.external_id ?? null,
    metadata: metadataPairs(org.metadata),
    domains: (org.domains ?? []).map((domain) => ({ ...domainNode(domain), domainCaptureEnabled: null })),
  };
}

/** `domain[]` + one shared verified flag (the dashboard input) → REST `domain_data`. */
function domainData(variables: { domains?: unknown; domainsDeveloperVerified?: unknown }) {
  if (!Array.isArray(variables.domains)) return undefined;
  const state = variables.domainsDeveloperVerified === false ? 'pending' : 'verified';
  return variables.domains.map((domain) => ({ domain: String(domain), state }));
}

export const organizationOperations: Record<string, ApiKeyOperation> = {
  async organizations(variables, ctx) {
    // The CLI's only search input is `--domain`, so it maps onto REST's
    // domain filter (an exact domain match).
    const domain = str(variables.search);
    const page = await ctx.request<WorkOSListResponse<RestOrganization>>({
      method: 'GET',
      path: '/organizations',
      params: {
        limit: num(variables.limit),
        before: str(variables.before),
        after: str(variables.after),
        order: restOrder(variables.order),
        domains: domain,
      },
    });
    return { organizations: listEnvelope((page?.data ?? []).map(organizationNode), page?.list_metadata) };
  },

  async organization(variables, ctx) {
    const org = await orNull(
      ctx.request<RestOrganization>({ method: 'GET', path: `/organizations/${encode(String(variables.id))}` }),
    );
    return { organization: org ? organizationNode(org) : null };
  },

  async createOrganization(variables, ctx) {
    const input = (variables.input ?? {}) as { name?: unknown; domains?: unknown; domainsDeveloperVerified?: unknown };
    const domains = domainData(input);
    const org = await ctx.request<RestOrganization>({
      method: 'POST',
      path: '/organizations',
      body: { name: input.name, ...(domains ? { domain_data: domains } : {}) },
    });
    // The create operation selects only id, name and domains.
    return {
      createOrganization: {
        __typename: 'OrganizationCreated',
        organization: { id: org.id, name: org.name ?? null, domains: (org.domains ?? []).map(domainNode) },
      },
    };
  },

  async updateOrganization(variables, ctx) {
    const domains = domainData(variables);
    const org = await ctx.request<RestOrganization>({
      method: 'PUT',
      path: `/organizations/${encode(String(variables.id))}`,
      body: {
        ...(variables.name !== undefined ? { name: variables.name } : {}),
        ...(domains ? { domain_data: domains } : {}),
      },
    });
    // The update operation selects only id, name and each domain's id/domain/state.
    return {
      updateOrganization: {
        __typename: 'UpdateOrganizationPayload',
        organization: {
          id: org.id,
          name: org.name ?? null,
          domains: (org.domains ?? []).map((d) => ({ id: d.id, domain: d.domain, state: d.state ?? null })),
        },
      },
    };
  },

  async deleteOrganization(variables, ctx) {
    const { organizationId } = (variables.input ?? {}) as { organizationId?: unknown };
    await ctx.request({ method: 'DELETE', path: `/organizations/${encode(String(organizationId))}` });
    return { deleteOrganization: { organization: { id: organizationId } } };
  },

  // --- org-domain ---------------------------------------------------------------

  async addDomains(variables, ctx) {
    const input = (variables.input ?? {}) as { organizationId?: unknown; domains?: unknown };
    const domains = Array.isArray(input.domains) ? input.domains.map(String) : [];
    const created: RestOrganizationDomain[] = [];
    for (const domain of domains) {
      created.push(
        await ctx.request<RestOrganizationDomain>({
          method: 'POST',
          path: '/organization_domains',
          body: { organization_id: input.organizationId, domain },
        }),
      );
    }
    // The dashboard's add selects id, state, domain and verificationStrategy:
    // it adds domains already verified, so there is no challenge to show.
    // REST adds them pending, so the DNS challenge needed to verify them rides
    // along in the same `verificationContent` field.
    return {
      addDomains: {
        __typename: 'DomainsAdded',
        domains: created.map((d) => ({
          id: d.id,
          state: d.state ?? null,
          domain: d.domain,
          verificationStrategy: d.verification_strategy ?? null,
          verificationContent: verificationContent(d),
        })),
      },
    };
  },

  async restartOrganizationDomainVerification(variables, ctx) {
    const domain = await ctx.request<RestOrganizationDomain>({
      method: 'POST',
      path: `/organization_domains/${encode(String(variables.id))}/verify`,
    });
    return {
      restartOrganizationDomainVerification: domain
        ? { ...domainNode(domain), domainCaptureEnabled: null }
        : { id: variables.id },
    };
  },

  async deleteOrganizationDomain(variables, ctx) {
    await ctx.request({ method: 'DELETE', path: `/organization_domains/${encode(String(variables.id))}` });
    return { deleteOrganizationDomain: { id: variables.id } };
  },
};
