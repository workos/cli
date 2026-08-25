/**
 * `workos portal` — Admin Portal setup links on the dashboard account plane.
 *
 * Migrated from the API-key REST plane (graphql-resource-migration Phase 7):
 * the subcommand surface (generate-link) is unchanged, but the link is now a
 * catalog-backed dashboard operation with the user's OAuth bearer. Output
 * shapes are new curated shapes (approved breaking change); the authoritative
 * examples live in `portal.spec.ts`.
 *
 * Backend divergences from REST (all loud, none faked):
 * - `--return-url` / `--success-url` have no equivalent on the backing
 *   operation → flags REMOVED (strict() rejects them at parse time).
 * - `--intent audit_logs` has no equivalent intent on the dashboard plane →
 *   structured error naming the supported set; `domain_verification` and
 *   `certificate_renewal` are supported.
 * - REST links expired after 5 minutes; setup links carry a server-side
 *   `expiresAt`, which the output prints. Generating a link expires prior
 *   links of the same intent.
 */

import chalk from 'chalk';
import { runEnvScopedOperation } from '../lib/dashboard-operation.js';
import { isJsonMode, outputJson, exitWithError } from '../utils/output.js';
import { enumOut } from '../utils/output-conventions.js';

/**
 * CLI intent grammar (frozen REST values) → backing enum names. `audit_logs`
 * is deliberately absent: the dashboard plane has no such intent, and a value
 * with no equivalent errors loudly rather than being faked.
 */
const INTENT_MAP: Record<string, string> = {
  sso: 'Sso',
  dsync: 'Dsync',
  log_streams: 'LogStreams',
  domain_verification: 'DomainVerification',
  certificate_renewal: 'CertificateRenewal',
};

const SUPPORTED_INTENTS = Object.keys(INTENT_MAP).join(', ');

/** Reverse map for echoing intents back in the CLI's grammar. */
const INTENT_REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(INTENT_MAP).map(([cli, op]) => [op, cli]),
);

interface PortalSetupLinkNode {
  id?: string | null;
  url?: string | null;
  intents?: string[] | null;
  state?: string | null;
  expiresAt?: string | null;
}

/**
 * The curated portal-setup-link shape — the `--json` contract. camelCase,
 * stable keys; intents echoed in the CLI's own grammar. See portal.spec.ts for
 * the authoritative example.
 */
function shapePortalSetupLink(link: PortalSetupLinkNode) {
  return {
    id: link.id ?? null,
    link: link.url ?? null,
    intents: (link.intents ?? []).map((intent) => INTENT_REVERSE_MAP[intent] ?? intent),
    state: enumOut(link.state),
    expiresAt: link.expiresAt ?? null,
  };
}

export interface PortalGenerateOptions {
  intent: string;
  organization: string;
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runPortalGenerateLink(options: PortalGenerateOptions): Promise<void> {
  const mappedIntent = INTENT_MAP[options.intent];
  if (!mappedIntent) {
    exitWithError({
      code: 'invalid_argument',
      message:
        options.intent === 'audit_logs'
          ? `Intent "audit_logs" is not available for setup links. Supported intents: ${SUPPORTED_INTENTS}.`
          : `Unknown intent "${options.intent}". Supported intents: ${SUPPORTED_INTENTS}.`,
    });
  }

  // The organization lives in the resolved environment, which rides as the header.
  // expireIntents is passed explicitly: omitted, the server expires ALL of the
  // organization's active setup links; scoped to the requested intent it expires
  // only prior links of the same intent (what the help text says).
  const { data } = await runEnvScopedOperation<{
    generatePortalSetupLink:
      | { __typename: 'PortalSetupLinkGenerated'; portalSetupLink: PortalSetupLinkNode }
      | { __typename: 'OrganizationNotFound'; organizationId: string };
  }>('generatePortalSetupLink', options, {
    input: {
      organizationId: options.organization,
      intents: [mappedIntent],
      expireIntents: [mappedIntent],
    },
  });

  const result = data.generatePortalSetupLink;
  if (result.__typename === 'OrganizationNotFound') {
    exitWithError({
      code: 'not_found',
      message: `Organization "${options.organization}" was not found in this environment.`,
    });
  }
  if (result.__typename !== 'PortalSetupLinkGenerated' || !('portalSetupLink' in result)) {
    exitWithError({ code: 'unexpected_result', message: 'Could not generate an Admin Portal setup link.' });
  }

  const link = shapePortalSetupLink(result.portalSetupLink);
  if (isJsonMode()) {
    outputJson({ portalSetupLink: link });
    return;
  }

  console.log(link.link ?? '');
  if (link.expiresAt) {
    console.log(chalk.dim(`Note: This link expires at ${link.expiresAt}. Prior ${options.intent} links are expired.`));
  } else {
    console.log(chalk.dim(`Prior ${options.intent} links are expired.`));
  }
}
