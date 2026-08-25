/**
 * json-contract.spec.ts — the single source of truth for the migrated
 * commands' `--json` output contract.
 *
 * Every migrated command's curated `--json` shape (`shapeOrganization`,
 * `shapeUser`, `shapeRole`, `shapePermission`, `shapeInvitation`, `shapeFlag`/
 * `shapeFlagDetail`, `shapeWebhookEndpoint`, `shapeEvent`, `shapeMembership`,
 * `shapeSession`, `shapeOrgDomain`) is exercised end to end here: a canonical
 * backend fixture is fed through the run* handlers in json mode, the console
 * payload is parsed, and the whole thing is snapshotted in ONE object.
 *
 * Any future change to a public `--json` shape now surfaces as a reviewable
 * diff in the single companion snapshot file.
 *
 * Fixture rules (deliberate, do not "fix" by pre-normalizing):
 *   - Backend enums use their REAL casing (TitleCase: `Verified`, `Active`,
 *     `Pending`, `Standard`, `Dns`, `SOME`). The point is to prove the
 *     normalization layer lowercases them; a pre-normalized fixture proves
 *     nothing (a casing bug shipped for exactly that reason).
 *   - Metadata uses the backend's real transport form: an ARRAY of
 *     `{key,value}` pairs, which the contract folds into an object map.
 *   - Nodes carry internal/backend-only fields the curated shapes must drop.
 *   - All ids and timestamps are fixed so the snapshot never churns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockRequireCommandToken = vi.fn();
const mockGraphqlRequest = vi.fn();
const mockConfirm = vi.fn();
const mockIsCancel = vi.fn(() => false);
const mockGetActiveEnvironment = vi.fn();
const mockGetConfig = vi.fn();

vi.mock('../lib/command-auth.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/command-auth.js')>();
  return {
    ...actual,
    requireCommandToken: () => mockRequireCommandToken(),
  };
});

vi.mock('../lib/dashboard-graphql.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/dashboard-graphql.js')>();
  return {
    ...actual,
    dashboardGraphqlRequest: (...args: unknown[]) => mockGraphqlRequest(...args),
  };
});

vi.mock('../utils/ui.js', () => ({
  default: {
    confirm: (...args: unknown[]) => mockConfirm(...args),
    isCancel: (...args: unknown[]) => mockIsCancel(...args),
    select: vi.fn(),
  },
}));

vi.mock('../lib/config-store.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/config-store.js')>();
  return {
    ...actual,
    getActiveEnvironment: () => mockGetActiveEnvironment(),
    getConfig: () => mockGetConfig(),
    setProfileEnvironmentId: vi.fn(),
  };
});

const { setOutputMode } = await import('../utils/output.js');
const { resetInteractionModeForTests } = await import('../utils/interaction-mode.js');
const { runOrgList, runOrgGet } = await import('./organization.js');
const { runUserList, runUserGet } = await import('./user.js');
const { runRoleList, runRoleGet } = await import('./role.js');
const { runPermissionList, runPermissionGet } = await import('./permission.js');
const { runInvitationList, runInvitationGet } = await import('./invitation.js');
const { runFeatureFlagList, runFeatureFlagGet } = await import('./feature-flag.js');
const { runWebhookList } = await import('./webhook.js');
const { runEventList } = await import('./event.js');
const { runMembershipList, runMembershipGet } = await import('./membership.js');
const { runSessionList } = await import('./session.js');
const { runOrgDomainGet } = await import('./org-domain.js');

// Projects carry IDs so the flag commands can derive the active environment's
// project (the flag operations are project-scoped).
const TEAM_PROJECTS_PAYLOAD = {
  currentTeam: {
    projectsV2: [
      { id: 'proj_1', environments: [{ id: 'env_profile', name: 'Sandbox', sandbox: true, clientId: null }] },
      { id: 'proj_2', environments: [{ id: 'env_other', name: 'Other', sandbox: false, clientId: null }] },
    ],
  },
};

/**
 * Route the wire mock: the environment resolver's / project derivation's
 * `teamProjectsV2` fetch gets the team payload, everything else gets the given
 * operation payload.
 */
function respondWith(payload: unknown): void {
  mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
    if (String(doc).includes('teamProjectsV2')) return TEAM_PROJECTS_PAYLOAD;
    return payload;
  });
}

/** feature-flag issues two distinct non-team documents; route them by name. */
function respondByDoc(router: (doc: string) => unknown): void {
  mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
    const text = String(doc);
    if (text.includes('teamProjectsV2')) return TEAM_PROJECTS_PAYLOAD;
    return router(text);
  });
}

// ---------------------------------------------------------------------------
// Canonical backend fixtures — REAL backend casing + transport shapes.
// ---------------------------------------------------------------------------

const ORG_NODE = {
  id: 'org_1',
  name: 'FooCorp',
  createdAt: '2026-01-01T00:00:00.000Z',
  usersCount: 3,
  allowProfilesOutsideOrganization: false,
  externalId: null,
  metadata: [{ key: 'team', value: 'blue' }],
  domains: [{ id: 'dom_1', domain: 'foo.com', state: 'Verified' }],
  // Internal fields the curated shape must drop:
  seeded: false,
  stripeCustomerId: 'cus_internal',
};

const USER_NODE = {
  id: 'user_1',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  createdAt: '2026-01-01T00:00:00.000Z',
  emailVerifiedAt: '2026-01-02T00:00:00.000Z',
  lastSignedInAt: '2026-02-01T00:00:00.000Z',
  sessionCount: 4,
  hasPassword: true,
  locale: 'en-US',
  externalId: null,
  profilePictureUrl: null,
  metadata: [{ key: 'team', value: 'blue' }],
  identities: {
    data: [
      {
        id: 'ident_1',
        status: 'Active',
        organization: { id: 'org_1', name: 'FooCorp' },
        roles: [{ id: 'role_1', name: 'member' }],
        // Internal fields the curated shape must drop:
        customAttributes: { internal: true },
        ssoProfile: null,
      },
    ],
  },
  authenticationFactors: [{ id: 'auth_factor_1', lastVerifiedAt: '2026-02-02T00:00:00.000Z' }],
  // Internal fields the curated shape must drop:
  googleOauthProfile: { id: 'oauth_1' },
  directoryUser: null,
};

const ROLE_NODE = {
  id: 'role_env',
  name: 'Admin',
  slug: 'admin',
  description: 'Administrator',
  state: 'Active',
  type: 'Environment',
  permissions: [{ id: 'perm_1', slug: 'users:read' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  // Internal fields the curated shape must drop:
  resourceTypeId: 'rt_1',
  defaultForOrganizationsCount: 0,
};

const PERMISSION_NODE = {
  id: 'perm_1',
  name: 'Read users',
  slug: 'users:read',
  description: 'Read user records',
  system: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  // Internal fields the curated shape must drop:
  environmentId: 'env_profile',
  isEnabledForApiKeys: true,
};

const INVITE_NODE = {
  __typename: 'UserlandUserInvite',
  id: 'invite_1',
  createdAt: '2026-01-01T00:00:00.000Z',
  inviteeEmail: 'jane@example.com',
  state: 'Pending',
  organization: { id: 'org_1', name: 'FooCorp' },
};

const FLAG_NODE = {
  id: 'flag_1',
  name: 'Beta',
  slug: 'beta',
  description: 'Beta feature',
  projectId: 'proj_1',
  owner: null,
  flagEnvironments: [
    {
      id: 'fe_1',
      environmentId: 'env_profile',
      flagId: 'flag_1',
      flagEnabled: false,
      defaultEnabled: true,
      accessType: 'SOME',
      organizations: [{ id: 'org_1', name: 'FooCorp' }],
      users: [{ id: 'user_1', email: 'a@example.com', firstName: 'A', lastName: 'B' }],
      uniqueUsersCount: 1,
    },
    // A different environment's state the curated shapes must NOT report:
    { id: 'fe_2', environmentId: 'env_other', flagId: 'flag_1', flagEnabled: true },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  tags: [{ id: 'tag_1', name: 'beta-wave' }],
};

const ENDPOINT_NODE = {
  id: 'we_1',
  endpointUrl: 'https://example.com/hook',
  events: ['dsync.user.created'],
  state: 'Active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const EVENT_NODE = {
  id: 'event_1',
  name: 'dsync.user.created',
  data: { directory_id: 'dir_1' },
  context: { actor: 'internal' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  metadata: {},
};

const MEMBERSHIP_NODE = {
  id: 'om_1',
  type: 'Standard',
  status: 'Active',
  organizationId: 'org_1',
  userlandUserId: 'user_1',
  directoryUserId: null,
  // `role`/`roles` arrive as `{ id, name }` objects — the shape normalizes them
  // to plain slugs/names.
  role: { id: 'role_1', name: 'member' },
  roles: [{ id: 'role_1', name: 'member' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
};

const SESSION_NODE = {
  __typename: 'UserlandSession',
  id: 'session_1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0',
  provider: 'Password',
  impersonator: null,
  impersonationReason: null,
  organization: { id: 'org_1', name: 'FooCorp' },
  application: { id: 'app_1', name: 'Web' },
  state: { __typename: 'UserlandSessionIssued', expiresAt: '2026-03-01T00:00:00.000Z' },
};

const DOMAIN_NODE = {
  id: 'org_domain_1',
  domain: 'example.com',
  state: 'Verified',
  subdomain: null,
  verificationContent: 'workos-verify=abc123',
  verificationStrategy: 'Dns',
  domainCaptureEnabled: false,
  domainCaptureEnabledBy: null,
};

describe('migrated commands --json contract', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    resetInteractionModeForTests();
    setOutputMode('json');
    mockRequireCommandToken.mockResolvedValue('tok_123');
    mockConfirm.mockReset();
    mockIsCancel.mockReset();
    mockIsCancel.mockReturnValue(false);
    mockGetActiveEnvironment.mockReturnValue({ apiKey: 'sk_ignored', environmentId: 'env_profile' });
    mockGetConfig.mockReturnValue({
      activeEnvironment: 'default',
      environments: { default: { apiKey: 'sk_ignored', environmentId: 'env_profile' } },
    });
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetInteractionModeForTests();
    setOutputMode('human');
  });

  /** Run a handler in json mode and return the parsed single-line payload. */
  async function render(run: () => Promise<void>): Promise<unknown> {
    consoleOutput = [];
    await run();
    return JSON.parse(consoleOutput[0]);
  }

  it('pins the complete public --json contract for every migrated command', async () => {
    const contract: Record<string, unknown> = {};

    respondWith({ organizations: { data: [ORG_NODE], listMetadata: { before: null, after: 'cursor_a' } } });
    contract['organization.list'] = await render(() => runOrgList({}));
    respondWith({ organization: ORG_NODE });
    contract['organization.get'] = await render(() => runOrgGet('org_1'));

    respondWith({ userlandUsers: { data: [USER_NODE], listMetadata: { before: null, after: 'cursor_a' } } });
    contract['user.list'] = await render(() => runUserList({}));
    respondWith({ userlandUser: USER_NODE });
    contract['user.get'] = await render(() => runUserGet('user_1'));

    respondWith({ rolesForEnvironment: { roles: [ROLE_NODE] } });
    contract['role.list'] = await render(() => runRoleList({}));
    respondWith({ rolesForEnvironment: { roles: [ROLE_NODE] } });
    contract['role.get'] = await render(() => runRoleGet('admin'));

    respondWith({ permissionsForEnvironment: { permissions: [PERMISSION_NODE] } });
    contract['permission.list'] = await render(() => runPermissionList({}));
    respondWith({ permissionsForEnvironment: { permissions: [PERMISSION_NODE] } });
    contract['permission.get'] = await render(() => runPermissionGet('users:read'));

    respondWith({ userlandUserInvites: { data: [INVITE_NODE], listMetadata: { before: null, after: 'cursor_a' } } });
    contract['invitation.list'] = await render(() => runInvitationList({}));
    respondWith({ userlandUserInvites: { data: [INVITE_NODE], listMetadata: { before: null, after: null } } });
    contract['invitation.get'] = await render(() => runInvitationGet('invite_1'));

    respondByDoc((doc) => {
      if (doc.includes('flagsForProject')) {
        return { flagsForProject: { data: [FLAG_NODE], listMetadata: { before: null, after: 'cursor_a' } } };
      }
      if (doc.includes('flagBySlug')) return { flagBySlug: FLAG_NODE };
      throw new Error(`Unrouted document in test: ${doc.slice(0, 80)}`);
    });
    contract['feature-flag.list'] = await render(() => runFeatureFlagList({}));
    contract['feature-flag.get'] = await render(() => runFeatureFlagGet('beta'));

    respondWith({ webhookEndpoints: { data: [ENDPOINT_NODE], listMetadata: { before: null, after: 'cursor_a' } } });
    contract['webhook.list'] = await render(() => runWebhookList({}));

    respondWith({ environment: { events: { data: [EVENT_NODE], listMetadata: { before: 'cursor_a', after: null } } } });
    contract['event.list'] = await render(() => runEventList({ events: ['dsync.user.created'] }));

    respondWith({ userlandUserOrganizationMemberships: { organizationMemberships: [MEMBERSHIP_NODE] } });
    contract['membership.list'] = await render(() => runMembershipList({ user: 'user_1' }));
    respondWith({ userlandUserOrganizationMembership: MEMBERSHIP_NODE });
    contract['membership.get'] = await render(() => runMembershipGet('om_1'));

    respondWith({
      userlandUser: {
        id: 'user_1',
        sessions: { data: [SESSION_NODE], listMetadata: { before: null, after: 'cursor_a' } },
      },
    });
    contract['session.list'] = await render(() => runSessionList('user_1', {}));

    respondWith({
      organizations: {
        data: [{ id: 'org_1', domains: [DOMAIN_NODE] }],
        listMetadata: { before: null, after: null },
      },
    });
    contract['org-domain.get'] = await render(() => runOrgDomainGet('org_domain_1', {}));

    expect(contract).toMatchSnapshot();
  });
});
