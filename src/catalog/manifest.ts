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
];

/** Returns the curated command allowlist. */
export function getManifest(): CommandJustification[] {
  return MANIFEST;
}
