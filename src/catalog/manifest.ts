import type { CommandJustification } from './manifest-types.js';

/**
 * The curated allowlist of catalog-driven commands.
 *
 * Each entry is a complete {@link CommandJustification} — the two-axis rubric
 * that justifies surfacing a catalog operation as a first-class WorkOS command.
 * Entries are validated by `validateManifest` (justification.ts) and gated in CI
 * via `pnpm justification:check`.
 *
 * Phase 2 ships the machinery with an empty manifest; the first real entries
 * (the first command category) land in Phase 3.
 *
 * Phase 3 adds the first category: account-plane lifecycle (environment /
 * project / team) — the dashboard management actions a user performs that the
 * CLI could not do before. Naturally low-load (cheap mutations + argument-less
 * reads), which is why it is first: it proves the framework without exercising
 * the deferred load-capping engine.
 */
const MANIFEST: CommandJustification[] = [
  // --- environment ---
  {
    command: 'environment create',
    mapsTo: 'createEnvironment',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Provision a sandbox/prod environment from setup scripts or CI',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'environment rename',
    mapsTo: 'renameEnvironment',
    audiences: ['human', 'agent'],
    useCase: 'Fix environment naming drift without the dashboard',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  // --- project ---
  {
    command: 'project create',
    mapsTo: 'createProjectWithNewEnvironments',
    audiences: ['human', 'ci'],
    useCase: 'Provision a project with fresh staging+prod envs during team/tenant setup',
    load: 'cheap',
    mutation: true,
    destructive: false,
    // require-flag: provisions a project AND multiple environments; gating
    // non-interactive runs behind --yes prevents a broken CI loop from spawning
    // many projects.
    ciPolicy: 'require-flag',
  },
  {
    command: 'project rename',
    mapsTo: 'renameProject',
    audiences: ['human', 'agent'],
    useCase: 'Rename a project',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'project list',
    mapsTo: 'teamProjectsV2',
    audiences: ['human', 'agent', 'ci'],
    useCase: "List the team's projects (scripting, discovery)",
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  // --- team ---
  {
    command: 'team members',
    mapsTo: 'teamMemberships',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'List dashboard team members (audits, offboarding scripts)',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'team invite',
    mapsTo: 'inviteUserToTeam',
    audiences: ['human', 'ci'],
    useCase: 'Invite a teammate to the dashboard team during onboarding automation',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'team change-role',
    mapsTo: 'changeRole',
    audiences: ['human'],
    useCase: "Change a team member's dashboard role",
    load: 'cheap',
    mutation: true,
    destructive: false,
    // require-flag: a privilege change; require explicit consent in
    // non-interactive use even though it is not destructive.
    ciPolicy: 'require-flag',
  },
  {
    command: 'team remove',
    mapsTo: 'removeUserFromTeam',
    audiences: ['human'],
    useCase: 'Offboard a member from the dashboard team',
    load: 'cheap',
    mutation: true,
    // destructive: revokes access, so confirmDestructive() forces interactive
    // confirmation or --yes. ciPolicy stays `allow` because the destructive gate
    // already covers the non-interactive case.
    destructive: true,
    ciPolicy: 'allow',
  },
  {
    command: 'team resend-invite',
    mapsTo: 'resendDashboardInvite',
    audiences: ['human', 'ci'],
    useCase: 'Resend an expired dashboard invite',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'team update',
    mapsTo: 'updateTeamDetails',
    audiences: ['human'],
    useCase: 'Rename the team/account',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'team set-mfa',
    mapsTo: 'updateTeamMfaRequirement',
    audiences: ['human'],
    useCase: 'Require or relax MFA for the dashboard team',
    load: 'cheap',
    mutation: true,
    destructive: false,
    // require-flag: a security-posture change; require explicit consent in
    // non-interactive use.
    ciPolicy: 'require-flag',
  },

  // --- Phase 4: AuthKit app config ---
  // Per-environment AuthKit setup surface (redirect URIs, CORS, logout URIs,
  // branding). All cheap + imperative; setters replace the full list but expose
  // a native `--dry-run` as the safety affordance, so none are `destructive` and
  // none are routed through confirmDestructive. `ci_policy: allow` because
  // setting these IS the setup automation we want humans/agents/CI to run.
  //
  // Selection note: we deliberately map to the environment-level ops
  // (`setRedirectUris`/`setLogoutUris`), NOT the application-level
  // `setAuthkitApplication*` ops, whose input types are named
  // `SetUserlandApplication*Input` (the `userland` leak the leak test cannot see,
  // since it only inspects op names/descriptions, not input-type names).
  {
    command: 'authkit redirect-uris list',
    mapsTo: 'redirectUris',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Inspect configured redirect URIs (verify setup, audits, scripting)',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'authkit redirect-uris set',
    mapsTo: 'setRedirectUris',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Set allowed redirect URIs when wiring AuthKit (setup scripts/CI); --dry-run validates first',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'authkit cors get',
    mapsTo: 'corsConfig',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Inspect allowed web origins (CORS)',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'authkit cors set',
    mapsTo: 'updateCorsConfig',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Set allowed web origins for the web/SPA app during setup; --dry-run validates first',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'authkit logout-uris list',
    mapsTo: 'logoutUris',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Inspect configured logout URIs',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'authkit logout-uris set',
    mapsTo: 'setLogoutUris',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Set allowed logout URIs during setup; --dry-run validates first',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'authkit branding get',
    mapsTo: 'environmentAppBranding',
    audiences: ['human', 'agent'],
    useCase: 'Inspect AuthKit branding (logos, theme) for an environment',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    // The only command that uploads files. Its input fields are `Upload`
    // scalars, which no JSON transport can carry — an MCP client physically
    // cannot call this, so the CLI is the agent-reachable path to setting
    // branding images. Not `destructive`: it replaces individual images, each
    // of which is re-uploadable, and it never clears one (an image is only
    // touched when its flag is passed).
    command: 'authkit branding set',
    mapsTo: 'updateAppBranding',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Upload AuthKit logo, icon, and favicon images when branding an app (setup scripts/CI)',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },

  // --- Resource migration: organization + user ---
  // First resource commands moved off the API-key REST plane onto the dashboard
  // account plane (graphql-resource-migration Phase 3). The command surface is
  // unchanged (same subcommands); the backend and output shapes are new. Lists
  // are single-page bounded reads with explicit pagination variables — `cheap`,
  // not `bulk` (nothing fans out). Deletes carry the catalog `confirmation`
  // phrase and are `destructive` (confirmDestructive: prompt or --yes; ciPolicy
  // stays `allow` because the destructive gate already covers non-interactive).
  {
    command: 'organization list',
    mapsTo: 'organizations',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'List organizations in the active environment (scripting, discovery, audits)',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'organization get',
    mapsTo: 'organization',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Inspect a single organization by ID',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'organization create',
    mapsTo: 'createOrganization',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Provision an organization (with optional domains) from setup scripts or CI',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'organization update',
    mapsTo: 'updateOrganization',
    audiences: ['human', 'agent'],
    useCase: "Update an organization's name or domains",
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'organization delete',
    mapsTo: 'deleteOrganization',
    audiences: ['human', 'agent'],
    useCase: 'Delete an organization (offboarding, test-tenant cleanup)',
    load: 'cheap',
    mutation: true,
    // destructive: the catalog confirmation phrase warns the delete cascades to
    // the organization's connections, directories, and users.
    destructive: true,
    ciPolicy: 'allow',
  },
  {
    command: 'user list',
    mapsTo: 'userlandUsers',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'List AuthKit users in the active environment (scripting, audits)',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'user get',
    mapsTo: 'userlandUser',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Inspect a single AuthKit user by ID',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'user update',
    mapsTo: 'updateUserlandUser',
    audiences: ['human', 'agent'],
    useCase: "Update an AuthKit user's profile (name, email, locale, external ID)",
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'user delete',
    mapsTo: 'deleteUserlandUser',
    audiences: ['human', 'agent'],
    useCase: 'Delete an AuthKit user (offboarding, test cleanup)',
    load: 'cheap',
    mutation: true,
    // destructive: permanently deletes the end user (catalog confirmation).
    destructive: true,
    ciPolicy: 'allow',
  },

  // --- Resource migration: identity cluster (membership / invitation / session) ---
  // graphql-resource-migration Phase 4. Same recipe as organization/user above:
  // unchanged subcommand grammar, dashboard-plane backend, new curated shapes.
  //
  // Mapping notes:
  // - `membership list` is backed by TWO ops: the by-user op filters only by
  //   user (no pagination), so the by-org path rides `userlandUsersByOrg`
  //   (org-filtered identities, full pagination). Both entries share the
  //   command noun.
  // - `invitation list` likewise splits env-wide vs by-org across two ops.
  // - `invitation get` has NO backing single-invite operation: it is a
  //   client-side filter over the `invitation list` env-wide op (capped, loud
  //   miss wording), so it deliberately has no manifest entry of its own.
  // - `membership delete <id>` is a two-step: the op is keyed by org+user, so
  //   the handler first resolves the membership via the `membership get` op.
  // - Role-changing / access-removing mutations follow the `team change-role`
  //   precedent: ciPolicy `require-flag`. Removals/revocations are
  //   `destructive` (confirmDestructive; ciPolicy stays `allow` because the
  //   destructive gate already covers non-interactive runs).
  {
    command: 'membership list',
    mapsTo: 'userlandUserOrganizationMemberships',
    audiences: ['human', 'agent', 'ci'],
    useCase: "List an AuthKit user's organization memberships (audits, scripting)",
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'membership list',
    mapsTo: 'userlandUsersByOrg',
    audiences: ['human', 'agent', 'ci'],
    useCase: "List an organization's members with roles and status (audits, scripting)",
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'membership get',
    mapsTo: 'userlandUserOrganizationMembership',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Inspect a single organization membership by ID',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'membership create',
    mapsTo: 'addUserlandUserToOrg',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Add a user to an organization (optionally with a role) from setup scripts or CI',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'membership update',
    mapsTo: 'updateRoleOnOrganizationMembership',
    audiences: ['human', 'agent'],
    useCase: "Change the role on a user's organization membership",
    load: 'cheap',
    mutation: true,
    destructive: false,
    // require-flag: a privilege change; require explicit consent in
    // non-interactive use (team change-role precedent).
    ciPolicy: 'require-flag',
  },
  {
    command: 'membership delete',
    mapsTo: 'removeMemberFromOrganization',
    audiences: ['human', 'agent'],
    useCase: 'Remove a user from an organization (offboarding)',
    load: 'cheap',
    mutation: true,
    // destructive: removes the user's access to the organization.
    destructive: true,
    ciPolicy: 'allow',
  },
  {
    command: 'membership deactivate',
    mapsTo: 'deactivateOrganizationMembership',
    audiences: ['human', 'agent'],
    useCase: 'Deactivate a membership so the user loses access to the organization',
    load: 'cheap',
    mutation: true,
    destructive: false,
    // require-flag: an access removal (reversible via reactivate); require
    // explicit consent in non-interactive use.
    ciPolicy: 'require-flag',
  },
  {
    command: 'membership reactivate',
    mapsTo: 'reactivateOrganizationMembership',
    audiences: ['human', 'agent'],
    useCase: 'Reactivate an inactive organization membership',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'invitation list',
    mapsTo: 'userlandUserInvites',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'List AuthKit user invitations in the active environment (audits, scripting)',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'invitation list',
    mapsTo: 'userlandUserInvitesByOrg',
    audiences: ['human', 'agent', 'ci'],
    useCase: "List an organization's pending AuthKit user invitations",
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'invitation send',
    mapsTo: 'createUserlandUserInvite',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Invite a user by email (optionally into an organization with a role) during onboarding automation',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'invitation revoke',
    mapsTo: 'revokeUserlandUserInvite',
    audiences: ['human', 'agent'],
    useCase: 'Revoke a pending invitation (mis-sent invites, offboarding)',
    load: 'cheap',
    mutation: true,
    // destructive: invalidates the pending invite link.
    destructive: true,
    ciPolicy: 'allow',
  },
  {
    command: 'invitation resend',
    mapsTo: 'resendUserlandUserInvite',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Resend the invitation email for a pending invite',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'session list',
    mapsTo: 'userlandSessions',
    audiences: ['human', 'agent', 'ci'],
    useCase: "List an AuthKit user's authentication sessions (security review, debugging)",
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'session revoke',
    mapsTo: 'revokeUserlandSession',
    audiences: ['human', 'agent'],
    useCase: 'Revoke a single user session (compromised device, forced logout)',
    load: 'cheap',
    mutation: true,
    // destructive: signs the session out; it can no longer authenticate.
    destructive: true,
    ciPolicy: 'allow',
  },

  // --- Resource migration: authorization cluster (role / permission / feature-flag) ---
  // graphql-resource-migration Phase 5. Same recipe as the earlier clusters:
  // unchanged subcommand grammar, dashboard-plane backend, new curated shapes.
  //
  // Mapping notes:
  // - `role list` is backed by TWO ops (environment-scoped vs organization-scoped
  //   listing); both entries share the command noun.
  // - `role get` has no single-role operation: it is a client-side filter over
  //   the scope's list op, so it deliberately has no manifest entry of its own
  //   (invitation-get precedent). The same list ops back the slug→ID resolution
  //   step of every role mutation.
  // - `role set-permissions` / `role add-permission` / `role remove-permission`
  //   ride the `role update` op: the backing mutation carries the role's full
  //   permission set, so the handlers read-merge-write over it. One op, one
  //   manifest entry — the `role update` entry's ciPolicy governs all four.
  // - `permission get/update/delete` resolve slugs via the `permission list` op.
  // - `feature-flag get` also backs the lookup step of every flag mutation, and
  //   `feature-flag enable` / `disable` / `add-target` / `remove-target` all ride
  //   the same per-environment update op (one op, one manifest entry).
  // - Privilege-shaping mutations (role/permission create+update, and the
  //   permission-assignment subcommands riding `role update`) follow the
  //   `team change-role` precedent: ciPolicy `require-flag`. Deletes are
  //   `destructive` (confirmDestructive; ciPolicy stays `allow` because the
  //   destructive gate already covers non-interactive runs). Feature-flag
  //   mutations are reversible configuration toggles, not privilege changes —
  //   ciPolicy `allow`.
  {
    command: 'role list',
    mapsTo: 'roles',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'List the roles defined in the active environment (audits, scripting)',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'role list',
    mapsTo: 'rolesForOrganization',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'List the roles assignable within an organization (audits, scripting)',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'role create',
    mapsTo: 'createRole',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Create an environment or organization role from setup scripts or CI',
    load: 'cheap',
    mutation: true,
    destructive: false,
    // require-flag: expands the privilege surface; require explicit consent in
    // non-interactive use (team change-role precedent).
    ciPolicy: 'require-flag',
  },
  {
    command: 'role update',
    mapsTo: 'updateRole',
    audiences: ['human', 'agent'],
    useCase: "Update a role's name, description, or assigned permissions",
    load: 'cheap',
    mutation: true,
    destructive: false,
    // require-flag: a privilege change (also gates set-permissions /
    // add-permission / remove-permission, which ride this op).
    ciPolicy: 'require-flag',
  },
  {
    command: 'role delete',
    mapsTo: 'deleteRole',
    audiences: ['human', 'agent'],
    useCase: 'Delete an organization-scoped role (cleanup, offboarding)',
    load: 'cheap',
    mutation: true,
    // destructive: permanently deletes the role; members lose it.
    destructive: true,
    ciPolicy: 'allow',
  },
  {
    command: 'permission list',
    mapsTo: 'permissions',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'List the permissions defined in the active environment (audits, scripting)',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'permission create',
    mapsTo: 'createPermission',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Create a permission during RBAC setup automation',
    load: 'cheap',
    mutation: true,
    destructive: false,
    // require-flag: expands the privilege surface (team change-role precedent).
    ciPolicy: 'require-flag',
  },
  {
    command: 'permission update',
    mapsTo: 'updatePermission',
    audiences: ['human', 'agent'],
    useCase: "Update a custom permission's name or description",
    load: 'cheap',
    mutation: true,
    destructive: false,
    // require-flag: a privilege-surface change (team change-role precedent).
    ciPolicy: 'require-flag',
  },
  {
    command: 'permission delete',
    mapsTo: 'deletePermission',
    audiences: ['human', 'agent'],
    useCase: 'Delete a custom permission (cleanup)',
    load: 'cheap',
    mutation: true,
    // destructive: permanently removes the permission from every role using it.
    destructive: true,
    ciPolicy: 'allow',
  },
  {
    command: 'feature-flag list',
    mapsTo: 'flags',
    audiences: ['human', 'agent', 'ci'],
    useCase: "List the project's feature flags with the active environment's state",
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'feature-flag get',
    mapsTo: 'flagBySlug',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Inspect a feature flag by slug (also backs the lookup step of flag mutations)',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'feature-flag enable',
    mapsTo: 'updateFlagEnvironment',
    audiences: ['human', 'agent', 'ci'],
    useCase:
      'Toggle a flag or adjust its targeting in the active environment (enable/disable/add-target/remove-target all ride this op)',
    load: 'cheap',
    mutation: true,
    destructive: false,
    // allow: reversible configuration toggle, not a privilege change; flipping
    // flags from CI/scripts is the intended automation.
    ciPolicy: 'allow',
  },

  // --- Resource migration: org-infrastructure cluster (event / org-domain) ---
  // graphql-resource-migration Phase 6. Same recipe as the earlier clusters:
  // unchanged subcommand grammar, dashboard-plane backend, new curated shapes.
  //
  // Mapping notes:
  // - `directory` STAYS on the REST plane this phase: the delta's stop-rule
  //   triggered. The catalog's only directory listings are org-scoped
  //   (`directoriesForOrganization`) or per-directory (`directorySummary`), and
  //   the upstream schema has no environment-wide directories query at all, so
  //   migrating would force `--org` onto `directory list` — a frozen-grammar
  //   violation. Recorded as the upstream catalog ask.
  // - `org-domain get` has NO backing single-domain query (the delta's
  //   `teamDashboardOrgDomains` candidate returns the domains of the team's OWN
  //   WorkOS organization — wrong plane): it is a client-side filter over one
  //   page of the `organizations` op (capped, loud miss wording), so it
  //   deliberately has no manifest entry of its own (invitation-get precedent).
  // - `org-domain verify` maps to the restart-DNS-verification op, which is what
  //   REST verify did (initiate verification); the instant manual-verify op is
  //   deliberately NOT surfaced (grammar frozen).
  // - Domain setters follow the `organization create/update` precedent (those
  //   already write domains): ciPolicy `allow`. The delete is `destructive`
  //   (confirmDestructive; ciPolicy stays `allow` because the destructive gate
  //   already covers non-interactive runs).
  {
    command: 'event list',
    mapsTo: 'environmentEvents',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Audit recent activity in the active environment (debugging, sync monitoring, scripting)',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'org-domain create',
    mapsTo: 'addDomains',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Add a verified domain to an organization from setup scripts or CI',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'org-domain verify',
    mapsTo: 'restartOrganizationDomainVerification',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Restart DNS verification for an organization domain (issues a fresh verification token)',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'org-domain delete',
    mapsTo: 'deleteOrganizationDomain',
    audiences: ['human', 'agent'],
    useCase: 'Remove a domain from an organization (cleanup, offboarding)',
    load: 'cheap',
    mutation: true,
    // destructive: removes the domain; domain-based sign-in and capture stop
    // working for it.
    destructive: true,
    ciPolicy: 'allow',
  },

  // --- Resource migration: app-config cluster (webhook / portal / config) ---
  // graphql-resource-migration Phase 7. Same recipe as the earlier clusters:
  // unchanged subcommand grammar, dashboard-plane backend, new curated shapes.
  //
  // Mapping notes:
  // - `config redirect add` and `config cors add` have NO entries of their own:
  //   the backing ops (`redirectUris`/`setRedirectUris`, `corsConfig`/
  //   `updateCorsConfig`) are already owned by the `authkit redirect-uris *` /
  //   `authkit cors *` entries above, and OVERRIDES is op-keyed (one op ↔ one
  //   command noun — the invitation-get precedent). The config subcommands are
  //   read-merge-write conveniences over those same full-list setters: fetch
  //   current, no-op if present, else append and set. The concurrent-editor
  //   race window is accepted and noted in help text (the same trade-off
  //   `authkit redirect-uris set` already makes).
  // - `config homepage-url set` is backed by TWO ops sharing the noun (the
  //   `membership list` precedent): `defaultAuthkitApplication` resolves the
  //   environment's default AuthKit application ID, then
  //   `updateAuthkitApplication` sets its homepage URL. This matches the REST
  //   endpoint's semantics, which dual-wrote the default application.
  // - `portal generate-link` generates a setup link and expires prior links of
  //   the same intent server-side; not destructive (links are re-generable) and
  //   generating them from scripts/CI is the intended automation (the
  //   onboard-org workflow precedent).
  // - `webhook delete` is `destructive` (confirmDestructive; the op carries no
  //   catalog confirmation phrase, so the consequence copy is hand-written;
  //   ciPolicy stays `allow` because the destructive gate already covers
  //   non-interactive runs).
  {
    command: 'webhook list',
    mapsTo: 'webhookEndpoints',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'List webhook endpoints in the active environment (verify setup, audits, scripting)',
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'webhook create',
    mapsTo: 'createWebhookEndpoint',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Register a webhook endpoint from setup scripts or CI',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'webhook delete',
    mapsTo: 'deleteWebhookEndpoint',
    audiences: ['human', 'agent'],
    useCase: 'Delete a webhook endpoint (cleanup, decommissioned receivers)',
    load: 'cheap',
    mutation: true,
    // destructive: the endpoint stops receiving events immediately.
    destructive: true,
    ciPolicy: 'allow',
  },
  {
    command: 'portal generate-link',
    mapsTo: 'generatePortalSetupLink',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Generate an Admin Portal setup link for an organization during onboarding automation',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'config homepage-url set',
    mapsTo: 'defaultAuthkitApplication',
    audiences: ['human', 'agent', 'ci'],
    useCase: "Resolve the environment's AuthKit application (the lookup step of homepage-url set)",
    load: 'cheap',
    mutation: false,
    destructive: false,
    ciPolicy: 'allow',
  },
  {
    command: 'config homepage-url set',
    mapsTo: 'updateAuthkitApplication',
    audiences: ['human', 'agent', 'ci'],
    useCase: 'Set the app homepage URL when wiring AuthKit (setup scripts/CI)',
    load: 'cheap',
    mutation: true,
    destructive: false,
    ciPolicy: 'allow',
  },
];

/** Returns the curated command allowlist. */
export function getManifest(): CommandJustification[] {
  return MANIFEST;
}
