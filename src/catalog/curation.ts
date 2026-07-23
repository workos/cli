import type { CatalogOperation } from './catalog-types.js';

/**
 * The curation layer: maps a raw catalog operation to a clean, user-facing
 * WorkOS command noun + description.
 *
 * The catalog mirrors the dashboard's internal GraphQL operations, so operation
 * names and descriptions can leak internal naming — most notably the `userland*`
 * prefix and the word "graphql" — and some descriptions are simply wrong
 * (`teamProjectsV2` is described as "Return the team for the current dashboard
 * session"). This layer hides that, applying the same clean rendering the
 * existing `whoami` command uses (User / Team / Environment nouns, no GraphQL).
 *
 * Contract:
 * - Any op whose catalog `name` OR `description` matches {@link LEAK_PATTERN}
 *   MUST have an entry in {@link OVERRIDES}. This is enforced by
 *   `no-graphql-leak.spec.ts` over the curated manifest.
 * - The default `describe` falls back to the catalog description only when it is
 *   clean; a rotten or leaky description requires an override.
 */

/** Internal naming that must never reach a user-facing command/description. */
export const LEAK_PATTERN = /graphql|userland/i;

export interface CommandMeta {
  /** Clean user-facing command noun, e.g. "project list". */
  command: string;
  /** Clean user-facing description. */
  describe: string;
}

/**
 * Per-operation overrides for command name + description.
 *
 * One entry per curated op whose catalog `name`/`description` leaks internal
 * naming (`userland`/`graphql`) or is wrong/rotten. Keyed by catalog operation
 * name.
 */
export const OVERRIDES: Record<string, CommandMeta> = {
  // --- Phase 3: account-plane lifecycle ---
  // Every curated op gets an override so the manifest's clean `command` noun is
  // the single source of truth (the catalog operation names like
  // `createEnvironment` are internal and would otherwise leak through as the
  // command name). Descriptions are rewritten to the user-facing voice and to
  // avoid GraphQL/internal phrasing.
  createEnvironment: { command: 'environment create', describe: 'Create a sandbox or production environment' },
  renameEnvironment: { command: 'environment rename', describe: 'Rename an environment' },
  // Description is wrong upstream ("Return the team for the current dashboard
  // session") — it actually lists a team's projects.
  teamProjectsV2: { command: 'project list', describe: 'List projects in the current team' },
  createProjectWithNewEnvironments: {
    command: 'project create',
    describe: 'Create a project with fresh staging and production environments',
  },
  renameProject: { command: 'project rename', describe: 'Rename a project' },
  teamMemberships: { command: 'team members', describe: 'List members of the current team' },
  inviteUserToTeam: { command: 'team invite', describe: 'Invite a user to the current team by email' },
  changeRole: { command: 'team change-role', describe: "Change a team member's role" },
  removeUserFromTeam: { command: 'team remove', describe: 'Remove a member from the current team' },
  resendDashboardInvite: { command: 'team resend-invite', describe: 'Resend an expired team invitation' },
  updateTeamDetails: { command: 'team update', describe: 'Rename the current team' },
  updateTeamMfaRequirement: { command: 'team set-mfa', describe: 'Set whether MFA is required for the team' },

  // `userland*` ops: the prefix is internal dashboard naming; the user-facing
  // noun is just "user".
  //
  // LIVE since the resource migration (Phase 3, graphql-resource-migration):
  // the REST `user` command (src/commands/user.ts) was replaced by these
  // dashboard-plane ops, which resolved the old noun collision by replacement —
  // the manifest now activates `userlandUsers` (user list), `userlandUser`
  // (user get), `updateUserlandUser` (user update), and `deleteUserlandUser`
  // (user delete).
  //
  // Still INERT (present here, absent from manifest.ts):
  // - `createUserlandUser`: the CLI's `user` command has never had a `create`
  //   subcommand and the migration deliberately does not add one.
  //
  // `userlandUsers` also remains the leak-spec worked example proving the
  // curation layer cleans a `userland`-leaking op name to a clean noun — it is
  // now load-bearing AND exemplary; never remove it.
  userlandUsers: { command: 'user list', describe: 'List AuthKit users in the current environment' },
  userlandUser: { command: 'user get', describe: 'Get an AuthKit user by ID' },
  updateUserlandUser: { command: 'user update', describe: "Update an AuthKit user's profile" },
  createUserlandUser: { command: 'user create', describe: 'Create a user' },
  deleteUserlandUser: { command: 'user delete', describe: 'Delete an AuthKit user' },

  // --- identity cluster (resource migration Phase 4) ---
  // The invite overrides staged in Phase 3 under the `user invite*` nouns went
  // LIVE here under the `invitation` command (their real owner) when the REST
  // `invitation` command was replaced. Memberships and sessions follow the same
  // pattern: every manifest-curated op gets an override so the manifest's clean
  // `command` noun is the single source of truth, and every `userland*` name is
  // hidden behind it.
  //
  // `membership list` and `invitation list` are each backed by two ops (by-user
  // vs by-org, env-wide vs by-org) — both ops resolve to the same command noun.
  userlandUserOrganizationMemberships: {
    command: 'membership list',
    describe: "List an AuthKit user's organization memberships",
  },
  userlandUsersByOrg: { command: 'membership list', describe: "List an organization's members" },
  userlandUserOrganizationMembership: { command: 'membership get', describe: 'Get an organization membership by ID' },
  addUserlandUserToOrg: { command: 'membership create', describe: 'Add a user to an organization' },
  updateRoleOnOrganizationMembership: {
    command: 'membership update',
    describe: "Change the role on a user's organization membership",
  },
  removeMemberFromOrganization: { command: 'membership delete', describe: 'Remove a user from an organization' },
  deactivateOrganizationMembership: {
    command: 'membership deactivate',
    describe: 'Deactivate an organization membership',
  },
  reactivateOrganizationMembership: {
    command: 'membership reactivate',
    describe: 'Reactivate an inactive organization membership',
  },
  userlandUserInvites: { command: 'invitation list', describe: 'List user invitations in the current environment' },
  userlandUserInvitesByOrg: { command: 'invitation list', describe: "List an organization's pending invitations" },
  createUserlandUserInvite: { command: 'invitation send', describe: 'Invite a user by email' },
  resendUserlandUserInvite: { command: 'invitation resend', describe: 'Resend a pending invitation' },
  revokeUserlandUserInvite: { command: 'invitation revoke', describe: 'Revoke a pending invitation' },
  userlandSessions: { command: 'session list', describe: "List an AuthKit user's sessions" },
  revokeUserlandSession: { command: 'session revoke', describe: 'Revoke a user session' },

  // --- organization (resource migration Phase 3) ---
  // Op names/descriptions are clean upstream, but every curated op still needs
  // an override so the manifest's clean `command` noun is the single source of
  // truth (the leak spec asserts meta.command === manifest entry.command).
  organizations: { command: 'organization list', describe: 'List organizations in the current environment' },
  organization: { command: 'organization get', describe: 'Get an organization by ID' },
  createOrganization: { command: 'organization create', describe: 'Create an organization with optional domains' },
  updateOrganization: { command: 'organization update', describe: "Update an organization's name or domains" },
  deleteOrganization: { command: 'organization delete', describe: 'Delete an organization' },

  // --- authorization cluster (resource migration Phase 5) ---
  // Op names are clean upstream, but several descriptions are rotten (the
  // vendored docstrings concatenate the sub-queries: "List roles defined in an
  // environment ... Return the role configuration for an environment"), and
  // every manifest-curated op needs an override so the manifest's clean
  // `command` noun is the single source of truth. One op ↔ one command noun:
  // multi-subcommand ops (`updateRole`, `updateFlagEnvironment`, the list ops
  // that back get/lookup steps) are keyed under their primary command — see the
  // manifest comment.
  roles: { command: 'role list', describe: 'List roles in the current environment' },
  rolesForOrganization: { command: 'role list', describe: "List an organization's assignable roles" },
  createRole: { command: 'role create', describe: 'Create an environment or organization role' },
  updateRole: { command: 'role update', describe: "Update a role's name, description, or permissions" },
  deleteRole: { command: 'role delete', describe: 'Delete an organization role' },
  permissions: { command: 'permission list', describe: 'List permissions in the current environment' },
  createPermission: { command: 'permission create', describe: 'Create a permission' },
  updatePermission: { command: 'permission update', describe: "Update a custom permission's name or description" },
  deletePermission: { command: 'permission delete', describe: 'Delete a custom permission' },
  flags: { command: 'feature-flag list', describe: 'List feature flags in the current project' },
  flagBySlug: { command: 'feature-flag get', describe: 'Get a feature flag by slug' },
  updateFlagEnvironment: {
    command: 'feature-flag enable',
    describe: "Update a feature flag's state and targeting in the current environment",
  },

  // --- org-infrastructure cluster (resource migration Phase 6) ---
  // Op names/descriptions are clean upstream, but every manifest-curated op
  // still needs an override so the manifest's clean `command` noun is the
  // single source of truth. `org-domain get` rides the `organizations` op
  // (owned by `organization list` above) with no entry of its own — see the
  // manifest comment. The `directory` command stays REST this phase (stop-rule:
  // no environment-wide directory listing exists), so no directory ops are
  // curated here.
  environmentEvents: { command: 'event list', describe: 'List recent events in the current environment' },
  addDomains: { command: 'org-domain create', describe: 'Add a verified domain to an organization' },
  restartOrganizationDomainVerification: {
    command: 'org-domain verify',
    describe: 'Restart verification for an organization domain',
  },
  deleteOrganizationDomain: { command: 'org-domain delete', describe: 'Remove a domain from an organization' },

  // --- app-config cluster (resource migration Phase 7) ---
  // Op names/descriptions are clean upstream, but every manifest-curated op
  // still needs an override so the manifest's clean `command` noun is the
  // single source of truth. `config redirect add` / `config cors add` ride the
  // redirectUris/setRedirectUris/corsConfig/updateCorsConfig ops that the
  // `authkit` nouns above already own (OVERRIDES is op-keyed; one op ↔ one
  // command noun) — see the manifest comment. `config homepage-url set` is
  // backed by TWO ops sharing the noun: the default-application resolution read
  // and the update mutation, whose `Userland*`-named input/union types the leak
  // test cannot see (it inspects op names/descriptions only) — the command
  // handlers must never echo those type names.
  webhookEndpoints: { command: 'webhook list', describe: 'List webhook endpoints in the current environment' },
  createWebhookEndpoint: {
    command: 'webhook create',
    describe: 'Create a webhook endpoint subscribed to the given events',
  },
  deleteWebhookEndpoint: {
    command: 'webhook delete',
    describe: 'Delete a webhook endpoint so it stops receiving events',
  },
  generatePortalSetupLink: {
    command: 'portal generate-link',
    describe: 'Generate an Admin Portal setup link for an organization',
  },
  defaultAuthkitApplication: {
    command: 'config homepage-url set',
    describe: "Set the app homepage URL on the environment's AuthKit application",
  },
  updateAuthkitApplication: {
    command: 'config homepage-url set',
    describe: "Set the app homepage URL on the environment's AuthKit application",
  },

  // --- Phase 4: AuthKit app config ---
  // These op names/descriptions are already clean (no leak), but each still needs
  // an override so resolveCommandMeta returns the manifest's clean noun (the leak
  // spec asserts meta.command === manifest entry.command). Branding maps to
  // `environmentAppBranding`, NOT `appBranding` (whose upstream description is the
  // rot "Return the team for the current dashboard session").
  redirectUris: { command: 'authkit redirect-uris list', describe: 'List configured redirect URIs for an environment' },
  setRedirectUris: { command: 'authkit redirect-uris set', describe: 'Set the allowed redirect URIs for an environment' },
  corsConfig: { command: 'authkit cors get', describe: 'Show the allowed web origins (CORS) for an environment' },
  updateCorsConfig: { command: 'authkit cors set', describe: 'Set the allowed web origins (CORS) for an environment' },
  logoutUris: { command: 'authkit logout-uris list', describe: 'List configured logout URIs for an environment' },
  setLogoutUris: { command: 'authkit logout-uris set', describe: 'Set the allowed logout URIs for an environment' },
  environmentAppBranding: { command: 'authkit branding get', describe: 'Show AuthKit branding (logos, theme) for an environment' },
};

/**
 * Resolves a catalog operation to clean, user-facing command metadata.
 *
 * Resolution order:
 * 1. An explicit {@link OVERRIDES} entry wins.
 * 2. Otherwise, the catalog name/description are used as-is — but only when both
 *    are clean. If either leaks internal naming ({@link LEAK_PATTERN}) and there
 *    is no override, the result still carries the leaked value so the
 *    no-graphql-leak test fails loudly; this is the signal that an override is
 *    required. (See {@link findLeaks} for the programmatic check used by the
 *    spec.)
 */
export function resolveCommandMeta(op: CatalogOperation): CommandMeta {
  const override = OVERRIDES[op.name];
  if (override) return override;
  return { command: op.name, describe: op.description };
}

/**
 * Returns the field names ('command' and/or 'describe') of resolved metadata
 * that still match {@link LEAK_PATTERN}. Empty array means clean.
 *
 * The no-graphql-leak test runs this over every curated op's resolved metadata
 * and asserts it is always empty.
 */
export function findLeaks(meta: CommandMeta): Array<keyof CommandMeta> {
  const leaks: Array<keyof CommandMeta> = [];
  if (LEAK_PATTERN.test(meta.command)) leaks.push('command');
  if (LEAK_PATTERN.test(meta.describe)) leaks.push('describe');
  return leaks;
}
