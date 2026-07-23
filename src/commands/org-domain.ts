/**
 * `workos org-domain` — organization-domain lifecycle on the dashboard account
 * plane.
 *
 * Migrated from the API-key REST SDK (graphql-resource-migration Phase 6): the
 * subcommand surface (get/create/verify/delete) is unchanged, but every
 * operation now runs catalog-backed dashboard operations with the user's OAuth
 * bearer. Output shapes are new curated shapes (approved breaking change); the
 * authoritative examples live in `org-domain.spec.ts`.
 *
 * Backend divergences from REST (all loud, none faked):
 * - `get <id>` has no backing single-domain query: it filters the first
 *   {@link ORG_DOMAIN_GET_SCAN_LIMIT} organizations' domains client-side
 *   (capped, loud miss wording — the invitation-get precedent).
 * - `create` adds the domain **already verified** (the dashboard's manual-add
 *   flow); REST created it pending and started DNS verification.
 * - `verify <id>` restarts DNS verification with a fresh token — the same
 *   initiate-verification semantics REST had. It does not instantly verify.
 *
 * Safety posture per the manifest: `delete` is destructive →
 * `confirmDestructive` (prompt, or --yes). The consequence copy is hand-written
 * (the operation carries no catalog confirmation phrase).
 */

import chalk from 'chalk';
import { runEnvScopedOperation } from '../lib/dashboard-operation.js';
import { confirmDestructive } from '../catalog/confirm.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { printDetailFields } from '../utils/resource-command.js';

/**
 * `get <id>` scans one page of organizations (each carrying its domains) — a
 * single bounded request, never an unbounded fan-out.
 */
export const ORG_DOMAIN_GET_SCAN_LIMIT = 100;

interface OrgDomainNode {
  id?: string | null;
  domain?: string | null;
  state?: string | null;
  subdomain?: string | null;
  verificationStrategy?: string | null;
  verificationContent?: string | null;
  domainCaptureEnabled?: boolean | null;
}

/**
 * The curated organization-domain shape — the `--json` contract for every
 * subcommand. camelCase, stable keys, no internal fields; fields the backing
 * operation does not select come back `null`. See org-domain.spec.ts for the
 * authoritative example.
 */
function shapeOrgDomain(domain: OrgDomainNode, organizationId: string | null) {
  return {
    id: domain.id ?? null,
    domain: domain.domain ?? null,
    state: domain.state ?? null,
    organizationId,
    subdomain: domain.subdomain ?? null,
    verificationStrategy: domain.verificationStrategy ?? null,
    verificationContent: domain.verificationContent ?? null,
    domainCaptureEnabled: domain.domainCaptureEnabled ?? null,
  };
}

type ShapedOrgDomain = ReturnType<typeof shapeOrgDomain>;

function printOrgDomainFields(domain: ShapedOrgDomain): void {
  const fields: Array<[string, unknown]> = [
    ['ID', domain.id],
    ['Domain', domain.domain],
    ['State', domain.state],
    ['Org ID', domain.organizationId],
    ['Verification', domain.verificationStrategy],
  ];
  printDetailFields(fields);
}

export interface OrgDomainGetOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runOrgDomainGet(id: string, options: OrgDomainGetOptions = {}): Promise<void> {
  // There is no single-domain operation, so filter one page of organizations'
  // domains client-side — capped, never an unbounded scan.
  const { data } = await runEnvScopedOperation<{
    organizations: {
      data: Array<{ id: string; domains?: OrgDomainNode[] | null }>;
    } | null;
  }>('organizations', options, (environmentId) => ({ environmentId, limit: ORG_DOMAIN_GET_SCAN_LIMIT }));

  let match: ShapedOrgDomain | undefined;
  for (const organization of data.organizations?.data ?? []) {
    const found = (organization.domains ?? []).find((candidate) => candidate.id === id);
    if (found) {
      match = shapeOrgDomain(found, organization.id);
      break;
    }
  }

  if (!match) {
    exitWithError({
      code: 'not_found',
      message: `Domain "${id}" was not found in the first ${ORG_DOMAIN_GET_SCAN_LIMIT} organizations in this environment. Use \`organization get <org-id>\` to inspect a specific organization's domains.`,
    });
  }

  if (isJsonMode()) {
    outputJson({ domain: match });
    return;
  }
  printOrgDomainFields(match);
}

export interface OrgDomainCreateOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  /** Organization ID (org_*) the domain is added to. */
  org: string;
}

export async function runOrgDomainCreate(domain: string, options: OrgDomainCreateOptions): Promise<void> {
  // The backing operation takes a domain list; the frozen single-domain grammar
  // passes a one-element list.
  const { data } = await runEnvScopedOperation<{
    addDomains:
      | { __typename: 'DomainsAdded'; domains: OrgDomainNode[] }
      | { __typename: 'ConsumerDomainForbidden'; domain: string }
      | { __typename: 'OrganizationDomainAlreadyInUse'; domain: string; organization: { name: string | null } }
      | { __typename: 'ExistingNonVerifiedDomain'; nonVerifiedDomain: { state: string | null; domain: string } };
  }>('addDomains', options, { input: { organizationId: options.org, domains: [domain] } });

  const result = data.addDomains;
  if (result.__typename === 'OrganizationDomainAlreadyInUse') {
    exitWithError({
      code: 'domain_in_use',
      message: `Domain "${result.domain}" is already in use by organization ${result.organization?.name ?? 'another organization'}.`,
    });
  }
  if (result.__typename === 'ConsumerDomainForbidden') {
    exitWithError({
      code: 'consumer_domain_forbidden',
      message: `"${result.domain}" is a consumer email domain and cannot be added to an organization.`,
    });
  }
  if (result.__typename === 'ExistingNonVerifiedDomain') {
    const existing = result.nonVerifiedDomain;
    exitWithError({
      code: 'domain_pending',
      message: `Domain "${existing.domain}" already exists on this organization in a non-verified state (${existing.state ?? 'pending'}). Delete it with \`org-domain delete\` before re-adding it.`,
    });
  }
  if (result.__typename !== 'DomainsAdded' || !('domains' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not add domain "${domain}".` });
  }

  const added = shapeOrgDomain(result.domains[0] ?? { domain }, options.org);
  if (isJsonMode()) {
    outputJson({ domain: added });
    return;
  }
  // Divergence from REST (loud): the dashboard adds the domain already
  // verified; there is no DNS-verification step to complete.
  outputSuccess(
    `Added domain ${chalk.bold(domain)} to organization ${chalk.bold(options.org)} (state: ${added.state ?? 'unknown'})`,
  );
}

export interface OrgDomainVerifyOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runOrgDomainVerify(id: string, options: OrgDomainVerifyOptions = {}): Promise<void> {
  // No result union: a bad ID surfaces as a wire-level error via
  // reportDashboardError.
  const { data } = await runEnvScopedOperation<{ restartOrganizationDomainVerification: OrgDomainNode }>(
    'restartOrganizationDomainVerification',
    options,
    { id },
  );

  const domain = shapeOrgDomain(data.restartOrganizationDomainVerification ?? { id }, null);
  if (isJsonMode()) {
    outputJson({ domain });
    return;
  }
  outputSuccess(
    `Restarted verification for domain ${chalk.bold(domain.domain ?? id)} (state: ${domain.state ?? 'unknown'})`,
  );
  if (domain.verificationContent) {
    console.log(chalk.dim(`Verification record: ${domain.verificationContent}`));
  }
}

export interface OrgDomainDeleteOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runOrgDomainDelete(id: string, options: OrgDomainDeleteOptions = {}): Promise<void> {
  // Destructive per the manifest: the operation carries no catalog confirmation
  // phrase, so the consequence copy is hand-written.
  await confirmDestructive(options, {
    action: `delete domain ${id} from its organization — domain-based sign-in and capture stop working for it`,
  });

  // No result union: a bad ID surfaces as a wire-level error via
  // reportDashboardError.
  await runEnvScopedOperation('deleteOrganizationDomain', options, { id });

  if (isJsonMode()) {
    outputJson({ deleted: id });
    return;
  }
  outputSuccess(`Deleted domain ${chalk.bold(id)}`);
}
