/**
 * `workos organization` — organization lifecycle on the dashboard account plane.
 *
 * Migrated from the API-key REST SDK (graphql-resource-migration Phase 3): the
 * subcommand surface (create/update/get/list/delete) is unchanged, but every
 * operation now runs catalog-backed dashboard operations with the user's OAuth
 * bearer — the same gated capability `team` / `authkit` use. Output shapes are
 * new curated shapes (approved breaking change); the authoritative examples
 * live in `organization.spec.ts`.
 *
 * Every operation here is environment-scoped: the target rides as the
 * `x-url-environment-id` header (and, where the operation declares it, as a
 * variable), resolved through `resolveEnvironmentTarget()`. Mutations
 * pre-validate the resolved target; reads trust stored state.
 *
 * Safety posture per the manifest: `organization delete` is destructive
 * (cascades to connections, directories, and users) → `confirmDestructive`
 * (prompt, or --yes).
 */

import chalk from 'chalk';
import { getOperation } from '../catalog/operation.js';
import { confirmDestructive } from '../catalog/confirm.js';
import { runEnvScopedOperation } from '../lib/dashboard-operation.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { normalizeOrder, printDetailFields, printPaginationFooter } from '../utils/resource-command.js';
import { formatTable } from '../utils/table.js';

const DOMAIN_STATES = ['verified', 'pending'] as const;
type DomainState = (typeof DOMAIN_STATES)[number];

export interface ParsedDomain {
  domain: string;
  state: DomainState;
}

/** Parse `domain[:state]` positionals; state defaults to `verified`. */
export function parseDomainArgs(args: string[]): ParsedDomain[] {
  return args.map((arg) => {
    const parts = arg.split(':');
    const state = parts[1] || 'verified';
    if (!(DOMAIN_STATES as readonly string[]).includes(state)) {
      exitWithError({
        code: 'invalid_argument',
        message: `Invalid domain state "${state}" for "${parts[0]}". Allowed states: ${DOMAIN_STATES.join(', ')}.`,
      });
    }
    return { domain: parts[0], state: state as DomainState };
  });
}

/**
 * The dashboard operation takes `domains: [String!]` plus a single
 * `domainsDeveloperVerified: Boolean` covering the whole list, so per-domain
 * states must agree: all `verified` → true, all `pending` → false, mixed →
 * structured error (the old per-domain REST shape cannot be represented).
 */
function domainsDeveloperVerified(domains: ParsedDomain[]): boolean {
  const states = new Set(domains.map((d) => d.state));
  if (states.size > 1) {
    exitWithError({
      code: 'invalid_argument',
      message: 'All domains must share the same state (verified or pending) — mixed states are not supported.',
    });
  }
  return !states.has('pending');
}

interface OrganizationDomainNode {
  id?: string | null;
  domain: string;
  state?: string | null;
}

interface OrganizationNode {
  id: string;
  name?: string | null;
  createdAt?: string | null;
  usersCount?: number | null;
  allowProfilesOutsideOrganization?: boolean | null;
  externalId?: string | null;
  metadata?: Array<{ key: string; value: string }> | null;
  domains?: OrganizationDomainNode[] | null;
}

/**
 * The curated organization shape — the `--json` contract for every subcommand.
 * camelCase, stable keys, no internal fields; see organization.spec.ts for the
 * authoritative example.
 */
function shapeOrganization(org: OrganizationNode) {
  return {
    id: org.id,
    name: org.name ?? null,
    createdAt: org.createdAt ?? null,
    usersCount: org.usersCount ?? null,
    allowProfilesOutsideOrganization: org.allowProfilesOutsideOrganization ?? null,
    externalId: org.externalId ?? null,
    domains: (org.domains ?? []).map((d) => ({ id: d.id ?? null, domain: d.domain, state: d.state ?? null })),
    metadata: org.metadata ?? [],
  };
}

export interface OrgListOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  /** `--domain` filter — served by the dashboard search (matches name/domain). */
  domain?: string;
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runOrgList(options: OrgListOptions = {}): Promise<void> {
  const order = normalizeOrder(options.order);
  const { data } = await runEnvScopedOperation<{
    organizations: {
      data: OrganizationNode[];
      listMetadata: { before: string | null; after: string | null };
    } | null;
  }>('organizations', options, (environmentId) => ({
    environmentId,
    ...(options.domain ? { search: options.domain } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.before ? { before: options.before } : {}),
    ...(options.after ? { after: options.after } : {}),
    ...(order ? { order } : {}),
  }));

  const organizations = data.organizations?.data ?? [];
  const pagination = {
    before: data.organizations?.listMetadata?.before ?? null,
    after: data.organizations?.listMetadata?.after ?? null,
  };

  if (isJsonMode()) {
    outputJson({ organizations: organizations.map(shapeOrganization), pagination });
    return;
  }

  if (organizations.length === 0) {
    console.log('No organizations found.');
    return;
  }

  const rows = organizations.map((org) => [
    org.id,
    org.name ?? chalk.dim('—'),
    (org.domains ?? []).map((d) => d.domain).join(', ') || chalk.dim('none'),
  ]);
  console.log(formatTable([{ header: 'ID' }, { header: 'Name' }, { header: 'Domains' }], rows));

  printPaginationFooter(pagination);
}

export interface OrgGetOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runOrgGet(orgId: string, options: OrgGetOptions = {}): Promise<void> {
  // The op takes only `id`; the resolved target still rides as the environment header.
  const { data } = await runEnvScopedOperation<{ organization: OrganizationNode | null }>('organization', options, {
    id: orgId,
  });

  if (!data.organization) {
    exitWithError({ code: 'not_found', message: `Organization "${orgId}" was not found in this environment.` });
  }

  const organization = shapeOrganization(data.organization);
  if (isJsonMode()) {
    outputJson({ organization });
    return;
  }

  const fields: Array<[string, unknown]> = [
    ['ID', organization.id],
    ['Name', organization.name],
    ['Created', organization.createdAt],
    ['Users', organization.usersCount],
    ['External ID', organization.externalId],
    ['Domains', organization.domains.map((d) => `${d.domain} (${d.state ?? 'unknown'})`).join(', ') || null],
  ];
  printDetailFields(fields);
}

export interface OrgCreateOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runOrgCreate(name: string, domainArgs: string[], options: OrgCreateOptions = {}): Promise<void> {
  const domains = parseDomainArgs(domainArgs);
  const developerVerified = domains.length > 0 ? domainsDeveloperVerified(domains) : undefined;

  // The resolved target is sent as both an input field and the environment header.
  const { data } = await runEnvScopedOperation<{
    createOrganization:
      | { __typename: 'OrganizationCreated'; organization: OrganizationNode }
      | { __typename: 'EnvironmentNotFound'; environmentId: string }
      | {
          __typename: 'OrganizationDomainAlreadyInUse';
          domain: string;
          organization: { id: string; name: string | null };
        }
      | { __typename: 'ConsumerDomainForbidden'; domain: string }
      | { __typename: 'ExternalIDAlreadyUsed'; externalId: string };
  }>('createOrganization', options, (environmentId) => ({
    input: {
      environmentId,
      name,
      ...(domains.length > 0
        ? { domains: domains.map((d) => d.domain), domainsDeveloperVerified: developerVerified }
        : {}),
    },
  }));

  const result = data.createOrganization;
  if (result.__typename === 'EnvironmentNotFound') {
    exitWithError({
      code: 'environment_not_found',
      message: `Environment "${result.environmentId}" was not found.`,
    });
  }
  if (result.__typename === 'OrganizationDomainAlreadyInUse') {
    exitWithError({
      code: 'domain_in_use',
      message: `Domain "${result.domain}" is already in use by organization ${result.organization.name ?? result.organization.id}.`,
    });
  }
  if (result.__typename === 'ConsumerDomainForbidden') {
    exitWithError({
      code: 'consumer_domain_forbidden',
      message: `"${result.domain}" is a consumer email domain and cannot be added to an organization.`,
    });
  }
  if (result.__typename === 'ExternalIDAlreadyUsed') {
    exitWithError({
      code: 'external_id_in_use',
      message: `External ID "${result.externalId}" is already in use.`,
    });
  }
  if (result.__typename !== 'OrganizationCreated' || !('organization' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not create organization "${name}".` });
  }

  const organization = shapeOrganization(result.organization);
  if (isJsonMode()) {
    outputJson({ organization });
    return;
  }
  outputSuccess(`Created organization ${chalk.bold(organization.name ?? organization.id)}`);
  console.log(chalk.dim(`  id: ${organization.id}`));
}

export interface OrgUpdateOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  domain?: string;
  state?: string;
}

export async function runOrgUpdate(orgId: string, name: string, options: OrgUpdateOptions = {}): Promise<void> {
  const domains = options.domain ? parseDomainArgs([`${options.domain}:${options.state || 'verified'}`]) : [];

  // The op takes flat variables keyed by organization ID; the resolved target rides as the header.
  const { data } = await runEnvScopedOperation<{
    updateOrganization:
      | { __typename: 'UpdateOrganizationPayload'; organization: OrganizationNode }
      | { __typename: 'ConsumerDomainForbidden'; domain: string }
      | { __typename: 'ExternalIDAlreadyUsed'; externalId: string };
  }>('updateOrganization', options, {
    id: orgId,
    name,
    ...(domains.length > 0
      ? { domains: domains.map((d) => d.domain), domainsDeveloperVerified: domainsDeveloperVerified(domains) }
      : {}),
  });

  const result = data.updateOrganization;
  if (result.__typename === 'ConsumerDomainForbidden') {
    exitWithError({
      code: 'consumer_domain_forbidden',
      message: `"${result.domain}" is a consumer email domain and cannot be added to an organization.`,
    });
  }
  if (result.__typename === 'ExternalIDAlreadyUsed') {
    exitWithError({
      code: 'external_id_in_use',
      message: `External ID "${result.externalId}" is already in use.`,
    });
  }
  if (result.__typename !== 'UpdateOrganizationPayload' || !('organization' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not update organization "${orgId}".` });
  }

  const organization = shapeOrganization(result.organization);
  if (isJsonMode()) {
    outputJson({ organization });
    return;
  }
  outputSuccess(`Updated organization ${chalk.bold(organization.name ?? organization.id)}`);
}

export interface OrgDeleteOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runOrgDelete(orgId: string, options: OrgDeleteOptions = {}): Promise<void> {
  const op = getOperation('deleteOrganization');
  // Destructive per the manifest; the consequence copy comes from the catalog's
  // confirmation phrase ("permanently deletes the organization and cascades to
  // its connections, directories, and users").
  const consequence = op.confirmation ? ` — this ${op.confirmation}` : '';
  await confirmDestructive(options, { action: `delete organization ${orgId}${consequence}` });

  await runEnvScopedOperation('deleteOrganization', options, { input: { organizationId: orgId } });

  if (isJsonMode()) {
    outputJson({ deleted: orgId });
    return;
  }
  outputSuccess(`Deleted organization ${chalk.bold(orgId)}`);
}
