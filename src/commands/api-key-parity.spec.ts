/**
 * Offline parity: every resource command's `--json` output must be the same on
 * the dashboard-session path and the API-key (REST) path.
 *
 * Each case runs the real handler twice against the same entity: once with the
 * dashboard wire mocked (real dashboard casing: `Verified`, `Active`, metadata
 * as `{key,value}` pairs) and once with `fetch` mocked to return real WorkOS
 * REST responses (snake_case keys, REST casing: `verified`, `EnvironmentRole`,
 * `enabled`, metadata as an object). The outputs must be deep-equal, except the
 * fields in `API_KEY_NULL_FIELDS`, which must be `null` on the key path (REST
 * has no source for them). A casing-only difference fails here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRestMock, restList } from '../lib/__test-helpers__/rest-mock.js';

const mockRequireCommandToken = vi.fn();
const mockGraphqlRequest = vi.fn();
const mockGetActiveEnvironment = vi.fn();
const mockGetConfig = vi.fn();

vi.mock('../lib/command-auth.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/command-auth.js')>();
  return { ...actual, requireCommandToken: () => mockRequireCommandToken() };
});

vi.mock('../lib/dashboard-graphql.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/dashboard-graphql.js')>();
  return { ...actual, dashboardGraphqlRequest: (...args: unknown[]) => mockGraphqlRequest(...args) };
});

vi.mock('../utils/ui.js', () => ({
  default: { confirm: vi.fn(), isCancel: vi.fn(() => false), select: vi.fn() },
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
const { setResourceApiKeyFlag } = await import('../lib/resource-auth.js');
const { API_KEY_NULL_FIELDS, apiKeyParityDiffs } = await import('../lib/api-key-operations/known-gaps.js');
const { runOrgList, runOrgGet } = await import('./organization.js');
const { runUserList, runUserGet } = await import('./user.js');
const { runRoleList, runRoleGet } = await import('./role.js');
const { runPermissionList, runPermissionGet } = await import('./permission.js');
const { runInvitationList, runInvitationGet } = await import('./invitation.js');
const { runMembershipList, runMembershipGet } = await import('./membership.js');
const { runSessionList } = await import('./session.js');
const { runWebhookList } = await import('./webhook.js');
const { runEventList } = await import('./event.js');
const { runFeatureFlagList, runFeatureFlagGet } = await import('./feature-flag.js');
const { runOrgDomainGet, runOrgDomainVerify } = await import('./org-domain.js');
const { runPortalGenerateLink } = await import('./portal.js');

const rest = createRestMock();

const TEAM_PROJECTS_PAYLOAD = {
  currentTeam: {
    projectsV2: [
      { id: 'proj_1', environments: [{ id: 'env_profile', name: 'Sandbox', sandbox: true, clientId: null }] },
    ],
  },
};

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-02-01T00:00:00.000Z';

// ---------------------------------------------------------------------------
// Dashboard fixtures (real dashboard casing and transport shapes)
// ---------------------------------------------------------------------------

const GQL_ORG = {
  id: 'org_1',
  name: 'FooCorp',
  createdAt: T0,
  usersCount: 3,
  allowProfilesOutsideOrganization: false,
  externalId: 'ext_1',
  metadata: [{ key: 'team', value: 'blue' }],
  domains: [{ id: 'dom_1', domain: 'foo.com', state: 'Verified', verificationStrategy: 'Dns' }],
  seeded: false,
};

const GQL_IDENTITY = {
  id: 'om_1',
  status: 'Active',
  directoryUserId: null,
  role: { id: 'role_member', name: 'Member' },
  roles: [{ id: 'role_member', name: 'Member' }],
  organization: { id: 'org_1', name: 'FooCorp' },
  createdAt: T0,
  updatedAt: T1,
};

const GQL_USER = {
  id: 'user_1',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  createdAt: T0,
  emailVerifiedAt: '2026-01-02T00:00:00.000Z',
  lastSignedInAt: T1,
  sessionCount: 4,
  hasPassword: true,
  locale: 'en-US',
  externalId: null,
  profilePictureUrl: 'https://example.com/jane.png',
  metadata: [{ key: 'team', value: 'blue' }],
  identities: { data: [GQL_IDENTITY] },
};

const GQL_ROLE = {
  id: 'role_admin',
  name: 'Admin',
  slug: 'admin',
  description: 'Administrator',
  state: 'Active',
  type: 'Environment',
  permissions: [{ id: 'perm_1', slug: 'users:read' }],
  createdAt: T0,
  updatedAt: T1,
};

const GQL_PERMISSION = {
  id: 'perm_1',
  name: 'Read users',
  slug: 'users:read',
  description: 'Read user records',
  system: false,
  createdAt: T0,
  updatedAt: T1,
};

const GQL_INVITE = {
  __typename: 'UserlandUserInvite',
  id: 'invitation_1',
  createdAt: T0,
  inviteeEmail: 'new@example.com',
  state: 'Pending',
  organization: { id: 'org_1', name: 'FooCorp' },
};

// The dashboard's membership record carries role IDs as plain strings
// (`UserlandUserOrganizationMembership.role` / `.roles`).
const GQL_MEMBERSHIP = {
  id: 'om_1',
  type: 'Manual',
  status: 'Active',
  organizationId: 'org_1',
  userlandUserId: 'user_1',
  directoryUserId: null,
  role: 'role_member',
  roles: ['role_member'],
  createdAt: T0,
  updatedAt: T1,
};

const GQL_SESSION = {
  __typename: 'UserlandSession',
  id: 'session_1',
  createdAt: T0,
  updatedAt: T1,
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0',
  provider: 'Password',
  impersonator: null,
  impersonationReason: null,
  organization: { id: 'org_1', name: 'FooCorp' },
  application: { id: 'app_1', name: 'Web' },
  state: { __typename: 'UserlandSessionIssued', expiresAt: '2026-03-01T00:00:00.000Z' },
};

const GQL_ENDPOINT = {
  id: 'we_1',
  endpointUrl: 'https://example.com/hook',
  events: ['user.created'],
  state: 'Active',
  createdAt: T0,
};

const GQL_EVENT = {
  id: 'event_1',
  name: 'user.created',
  data: { id: 'user_1' },
  context: {},
  createdAt: T0,
  updatedAt: T0,
  metadata: {},
};

const GQL_FLAG = {
  id: 'flag_1',
  name: 'Beta',
  slug: 'beta',
  description: 'Beta feature',
  projectId: 'proj_1',
  flagEnvironments: [
    {
      id: 'fe_1',
      environmentId: 'env_profile',
      flagId: 'flag_1',
      flagEnabled: true,
      defaultEnabled: false,
      accessType: 'SOME',
      organizations: [{ id: 'org_1', name: 'FooCorp' }],
      users: [],
    },
  ],
  createdAt: T0,
  updatedAt: T1,
  tags: [{ id: 'tag_1', name: 'beta-wave' }],
};

const GQL_DOMAIN = {
  id: 'dom_1',
  domain: 'foo.com',
  state: 'Verified',
  subdomain: null,
  verificationContent: 'workos-verify=abc123',
  verificationStrategy: 'Dns',
  domainCaptureEnabled: false,
};

// ---------------------------------------------------------------------------
// REST fixtures (real WorkOS REST response shapes and casing)
// ---------------------------------------------------------------------------

const REST_ORG = {
  object: 'organization',
  id: 'org_1',
  name: 'FooCorp',
  domains: [
    {
      object: 'organization_domain',
      id: 'dom_1',
      organization_id: 'org_1',
      domain: 'foo.com',
      state: 'verified',
      verification_strategy: 'dns',
      verification_token: 'abc123',
      verification_prefix: 'workos-verify',
      created_at: T0,
      updated_at: T0,
    },
  ],
  metadata: { team: 'blue' },
  external_id: 'ext_1',
  stripe_customer_id: 'cus_internal',
  allow_profiles_outside_organization: false,
  created_at: T0,
  updated_at: T1,
};

const REST_USER = {
  object: 'user',
  id: 'user_1',
  email: 'jane@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  email_verified: true,
  profile_picture_url: 'https://example.com/jane.png',
  last_sign_in_at: T1,
  locale: 'en-US',
  external_id: null,
  metadata: { team: 'blue' },
  created_at: T0,
  updated_at: T1,
};

const REST_MEMBERSHIP = {
  object: 'organization_membership',
  id: 'om_1',
  user_id: 'user_1',
  organization_id: 'org_1',
  organization_name: 'FooCorp',
  status: 'active',
  directory_managed: false,
  role: { slug: 'member' },
  roles: [{ slug: 'member' }],
  custom_attributes: {},
  created_at: T0,
  updated_at: T1,
};

const REST_ROLE_MEMBER = {
  object: 'role',
  id: 'role_member',
  name: 'Member',
  slug: 'member',
  description: null,
  type: 'EnvironmentRole',
  resource_type_slug: 'organization',
  permissions: [],
  created_at: T0,
  updated_at: T0,
};

const REST_ROLE_ADMIN = {
  object: 'role',
  id: 'role_admin',
  name: 'Admin',
  slug: 'admin',
  description: 'Administrator',
  type: 'EnvironmentRole',
  resource_type_slug: 'organization',
  permissions: ['users:read'],
  created_at: T0,
  updated_at: T1,
};

const REST_PERMISSION = {
  object: 'permission',
  id: 'perm_1',
  slug: 'users:read',
  name: 'Read users',
  description: 'Read user records',
  system: false,
  resource_type_slug: 'organization',
  created_at: T0,
  updated_at: T1,
};

const REST_INVITE = {
  object: 'invitation',
  id: 'invitation_1',
  email: 'new@example.com',
  state: 'pending',
  accepted_at: null,
  revoked_at: null,
  expires_at: '2026-01-08T00:00:00.000Z',
  organization_id: 'org_1',
  inviter_user_id: null,
  accepted_user_id: null,
  token: 'tok_secret',
  accept_invitation_url: 'https://example.com/invite',
  created_at: T0,
  updated_at: T0,
};

const REST_SESSION = {
  object: 'session',
  id: 'session_1',
  impersonator: null,
  ip_address: '203.0.113.7',
  organization_id: 'org_1',
  user_agent: 'Mozilla/5.0',
  user_id: 'user_1',
  auth_method: 'password',
  status: 'active',
  expires_at: '2026-03-01T00:00:00.000Z',
  ended_at: null,
  created_at: T0,
  updated_at: T1,
};

const REST_ENDPOINT = {
  object: 'webhook_endpoint',
  id: 'we_1',
  endpoint_url: 'https://example.com/hook',
  secret: 'whsec_internal',
  status: 'enabled',
  events: ['user.created'],
  created_at: T0,
  updated_at: T0,
};

const REST_EVENT = {
  object: 'event',
  id: 'event_1',
  event: 'user.created',
  data: { id: 'user_1' },
  created_at: T0,
  context: {},
};

const REST_FLAG = {
  object: 'feature_flag',
  id: 'flag_1',
  slug: 'beta',
  name: 'Beta',
  description: 'Beta feature',
  owner: null,
  tags: ['beta-wave'],
  enabled: true,
  default_value: false,
  created_at: T0,
  updated_at: T1,
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let consoleOutput: string[];

async function render(run: () => Promise<void>): Promise<Record<string, unknown>> {
  consoleOutput = [];
  await run();
  return JSON.parse(consoleOutput[0]);
}

/** Run on the dashboard path: no key, signed in, dashboard wire mocked. */
async function viaSession(router: (doc: string) => unknown, run: () => Promise<void>) {
  vi.stubEnv('WORKOS_API_KEY', '');
  mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
    const text = String(doc);
    if (text.includes('teamProjectsV2')) return TEAM_PROJECTS_PAYLOAD;
    return router(text);
  });
  rest.respond({});
  const output = await render(run);
  expect(rest.calls).toHaveLength(0);
  return output;
}

/** Run on the API-key path: WORKOS_API_KEY set, REST mocked. */
async function viaApiKey(routes: Parameters<typeof rest.respond>[0], run: () => Promise<void>) {
  vi.stubEnv('WORKOS_API_KEY', 'sk_test_parity');
  mockGraphqlRequest.mockReset();
  mockRequireCommandToken.mockClear();
  rest.respond(routes);
  const output = await render(run);
  expect(mockGraphqlRequest).not.toHaveBeenCalled();
  expect(mockRequireCommandToken).not.toHaveBeenCalled();
  for (const call of rest.calls) expect(call.authorization).toBe('Bearer sk_test_parity');
  return output;
}

type Json = Record<string, unknown>;

/** First value at a gap path (`[]` steps into the first element), for checking a fixture exercises the gap. */
function firstAt(value: unknown, path: string): unknown {
  let node: unknown = Array.isArray(value) ? value[0] : value;
  for (const segment of path.split('.')) {
    const key = segment.replace(/\[\]$/, '');
    node = (node as Record<string, unknown> | null)?.[key];
    if (segment.endsWith('[]')) node = Array.isArray(node) ? node[0] : undefined;
  }
  return node;
}

/**
 * Assert the two outputs are identical: same envelope and pagination, and the
 * entity (or rows) judged by the shared `apiKeyParityDiffs`, which allows only
 * documented null leaves. `expectedGaps` names the gaps this fixture exercises
 * (the session side has a value there), so a test can't pass vacuously.
 */
function expectParity(command: string, session: Json, apiKey: Json, expectedGaps: string[] = []): void {
  expect(Object.keys(apiKey).sort()).toEqual(Object.keys(session).sort());
  const entityKey = Object.keys(session).find((key) => key !== 'pagination') as string;
  const { [entityKey]: sessionEntity, ...sessionEnvelope } = session;
  const { [entityKey]: apiKeyEntity, ...apiKeyEnvelope } = apiKey;
  expect(apiKeyEnvelope).toEqual(sessionEnvelope);
  expect(apiKeyParityDiffs(command, sessionEntity, apiKeyEntity)).toEqual([]);
  for (const gap of expectedGaps) {
    expect(API_KEY_NULL_FIELDS, `${command}.${gap} must be a documented gap`).toHaveProperty([`${command}.${gap}`]);
    expect(firstAt(sessionEntity, gap), `${gap} has a value on the session side`).not.toBeNull();
    expect(firstAt(apiKeyEntity, gap), `${gap} on the API-key side`).toBeNull();
  }
}

describe('resource command --json parity, session vs API key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInteractionModeForTests();
    setOutputMode('json');
    setResourceApiKeyFlag(undefined);
    vi.stubGlobal('fetch', rest.fetchMock);
    vi.stubEnv('WORKOS_API_URL', '');
    vi.stubEnv('WORKOS_API_BASE_URL', '');
    mockRequireCommandToken.mockResolvedValue('tok_123');
    // A claimed profile with a stored key: the session path must still win without an explicit key.
    mockGetActiveEnvironment.mockReturnValue({
      name: 'sandbox',
      type: 'sandbox',
      apiKey: 'sk_stored',
      environmentId: 'env_profile',
    });
    mockGetConfig.mockReturnValue({
      activeEnvironment: 'sandbox',
      environments: {
        sandbox: { name: 'sandbox', type: 'sandbox', apiKey: 'sk_stored', environmentId: 'env_profile' },
      },
    });
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetInteractionModeForTests();
    setOutputMode('human');
  });

  it('organization list matches with an API key', async () => {
    const session = await viaSession(
      () => ({ organizations: { data: [GQL_ORG], listMetadata: { before: null, after: 'org_1' } } }),
      () => runOrgList({}),
    );
    const apiKey = await viaApiKey({ 'GET /organizations': restList([REST_ORG], 'org_1') }, () => runOrgList({}));

    expectParity('organization', session, apiKey, ['usersCount']);
    expect(apiKey).toMatchObject({ organizations: [{ domains: [{ state: 'verified' }], metadata: { team: 'blue' } }] });
  });

  it('organization get matches with an API key', async () => {
    const session = await viaSession(
      () => ({ organization: GQL_ORG }),
      () => runOrgGet('org_1'),
    );
    const apiKey = await viaApiKey({ 'GET /organizations/org_1': REST_ORG }, () => runOrgGet('org_1'));

    expectParity('organization', session, apiKey, ['usersCount']);
  });

  const userRestRoutes = {
    'GET /user_management/users': restList([REST_USER], 'user_1'),
    'GET /user_management/users/user_1': REST_USER,
    'GET /user_management/organization_memberships': restList([REST_MEMBERSHIP]),
    'GET /user_management/users/user_1/auth_factors': restList([
      {
        object: 'authentication_factor',
        id: 'auth_factor_1',
        type: 'totp',
        user_id: 'user_1',
        created_at: T0,
        updated_at: T0,
      },
    ]),
    'GET /authorization/roles': { object: 'list', data: [REST_ROLE_MEMBER, REST_ROLE_ADMIN] },
  };

  it('user list matches with an API key', async () => {
    const session = await viaSession(
      () => ({ userlandUsers: { data: [GQL_USER], listMetadata: { before: null, after: 'user_1' } } }),
      () => runUserList({}),
    );
    const apiKey = await viaApiKey(userRestRoutes, () => runUserList({}));

    expectParity('user', session, apiKey, ['sessionCount', 'hasPassword', 'emailVerifiedAt']);
    // Identities are filled from memberships, with role IDs/names resolved from slugs.
    expect(apiKey).toMatchObject({
      users: [
        {
          identities: [
            {
              id: 'om_1',
              state: 'active',
              organization: { id: 'org_1', name: 'FooCorp' },
              roles: [{ id: 'role_member', name: 'Member' }],
            },
          ],
        },
      ],
    });
    expect(rest.callsTo('GET /user_management/organization_memberships')[0].query).toMatchObject({ user_id: 'user_1' });
  });

  it('user get matches with an API key', async () => {
    const session = await viaSession(
      () => ({
        userlandUser: { ...GQL_USER, authenticationFactors: [{ id: 'auth_factor_1', lastVerifiedAt: T1 }] },
      }),
      () => runUserGet('user_1'),
    );
    const apiKey = await viaApiKey(userRestRoutes, () => runUserGet('user_1'));

    expectParity('user', session, apiKey, [
      'sessionCount',
      'hasPassword',
      'emailVerifiedAt',
      'authenticationFactors[].lastVerifiedAt',
    ]);
  });

  it('user get shows an organization role that shadows an environment slug, matching the dashboard, with an API key', async () => {
    const orgMember = { ...REST_ROLE_MEMBER, id: 'role_org_member', name: 'Org Member', type: 'OrganizationRole' };
    const session = await viaSession(
      () => ({
        userlandUser: {
          ...GQL_USER,
          identities: { data: [{ ...GQL_IDENTITY, roles: [{ id: 'role_org_member', name: 'Org Member' }] }] },
          authenticationFactors: [],
        },
      }),
      () => runUserGet('user_1'),
    );
    const apiKey = await viaApiKey(
      {
        ...userRestRoutes,
        'GET /user_management/users/user_1/auth_factors': restList([]),
        // The organization's list carries both the inherited environment role and its own role of the same slug.
        'GET /authorization/organizations/org_1/roles': { object: 'list', data: [REST_ROLE_MEMBER, orgMember] },
      },
      () => runUserGet('user_1'),
    );
    expectParity('user', session, apiKey, ['sessionCount', 'hasPassword', 'emailVerifiedAt']);
    expect(apiKey).toMatchObject({
      user: { identities: [{ roles: [{ id: 'role_org_member', name: 'Org Member' }] }] },
    });
  });

  it('role list and get match with an API key', async () => {
    const router = () => ({ rolesForEnvironment: { roles: [GQL_ROLE] } });
    const routes = { 'GET /authorization/roles': { object: 'list', data: [REST_ROLE_ADMIN] } };

    expectParity(
      'role',
      await viaSession(router, () => runRoleList({})),
      await viaApiKey(routes, () => runRoleList({})),
    );
    expectParity(
      'role',
      await viaSession(router, () => runRoleGet('admin')),
      await viaApiKey(routes, () => runRoleGet('admin')),
    );
  });

  it('organization role list matches with an API key', async () => {
    const orgRole = { ...GQL_ROLE, id: 'role_org', slug: 'billing', type: 'Organization' };
    const restOrgRole = { ...REST_ROLE_ADMIN, id: 'role_org', slug: 'billing', type: 'OrganizationRole' };
    const session = await viaSession(
      () => ({ rolesForOrganization: { roles: [GQL_ROLE, orgRole] } }),
      () => runRoleList({ org: 'org_1' }),
    );
    const apiKey = await viaApiKey(
      { 'GET /authorization/organizations/org_1/roles': { object: 'list', data: [REST_ROLE_ADMIN, restOrgRole] } },
      () => runRoleList({ org: 'org_1' }),
    );
    expectParity('role', session, apiKey);
    expect(apiKey).toMatchObject({ roles: [{ type: 'environment' }, { type: 'organization' }] });
  });

  it('permission list and get match with an API key', async () => {
    const router = () => ({ permissionsForEnvironment: { permissions: [GQL_PERMISSION] } });
    const routes = { 'GET /authorization/permissions': restList([REST_PERMISSION]) };

    expectParity(
      'permission',
      await viaSession(router, () => runPermissionList({})),
      await viaApiKey(routes, () => runPermissionList({})),
    );
    expectParity(
      'permission',
      await viaSession(router, () => runPermissionGet('users:read')),
      await viaApiKey(routes, () => runPermissionGet('users:read')),
    );
  });

  it('invitation list and get match with an API key', async () => {
    const router = () => ({ userlandUserInvites: { data: [GQL_INVITE], listMetadata: { before: null, after: null } } });
    const routes = {
      'GET /user_management/invitations': restList([REST_INVITE]),
      'GET /organizations/org_1': REST_ORG,
    };

    expectParity(
      'invitation',
      await viaSession(router, () => runInvitationList({})),
      await viaApiKey(routes, () => runInvitationList({})),
    );
    expectParity(
      'invitation',
      await viaSession(router, () => runInvitationGet('invitation_1')),
      await viaApiKey(routes, () => runInvitationGet('invitation_1')),
    );
  });

  it('invitation list by organization matches with an API key', async () => {
    const { organization: _organization, ...byOrgInvite } = GQL_INVITE;
    const session = await viaSession(
      () => ({
        organization: { userlandUserInvites: { data: [byOrgInvite], listMetadata: { before: null, after: null } } },
      }),
      () => runInvitationList({ org: 'org_1' }),
    );
    const apiKey = await viaApiKey(
      { 'GET /organizations/org_1': REST_ORG, 'GET /user_management/invitations': restList([REST_INVITE]) },
      () => runInvitationList({ org: 'org_1' }),
    );
    expectParity('invitation', session, apiKey);
    expect(rest.callsTo('GET /user_management/invitations')[0].query).toMatchObject({ organization_id: 'org_1' });
  });

  it('membership list (by user) and get match with an API key', async () => {
    expectParity(
      'membership',
      await viaSession(
        () => ({ userlandUserOrganizationMemberships: { organizationMemberships: [GQL_MEMBERSHIP] } }),
        () => runMembershipList({ user: 'user_1' }),
      ),
      await viaApiKey(
        {
          'GET /user_management/organization_memberships': restList([REST_MEMBERSHIP]),
          'GET /authorization/roles': { object: 'list', data: [REST_ROLE_MEMBER] },
        },
        () => runMembershipList({ user: 'user_1' }),
      ),
      ['type'],
    );
    expectParity(
      'membership',
      await viaSession(
        () => ({ userlandUserOrganizationMembership: GQL_MEMBERSHIP }),
        () => runMembershipGet('om_1'),
      ),
      await viaApiKey(
        {
          'GET /user_management/organization_memberships/om_1': REST_MEMBERSHIP,
          'GET /authorization/roles': { object: 'list', data: [REST_ROLE_MEMBER] },
        },
        () => runMembershipGet('om_1'),
      ),
      ['type'],
    );
  });

  it('membership roles are role IDs on records and display names by organization, with an API key', async () => {
    const routes = {
      'GET /organizations/org_1': REST_ORG,
      'GET /user_management/organization_memberships': restList([REST_MEMBERSHIP]),
      'GET /authorization/roles': { object: 'list', data: [REST_ROLE_MEMBER] },
    };
    const byUser = await viaApiKey(routes, () => runMembershipList({ user: 'user_1' }));
    const byOrg = await viaApiKey(routes, () => runMembershipList({ org: 'org_1' }));

    // REST's slug ("member") must not leak: records carry the role ID, identities the name.
    expect(byUser).toMatchObject({ memberships: [{ role: 'role_member', roles: ['role_member'] }] });
    expect(byOrg).toMatchObject({ memberships: [{ role: 'Member', roles: ['Member'] }] });
  });

  it('membership list (by organization) matches with an API key', async () => {
    const session = await viaSession(
      () => ({
        organization: {
          userlandUsers: {
            data: [
              {
                id: 'user_1',
                // The by-organization query selects only each role's name.
                identities: { data: [{ ...GQL_IDENTITY, role: { name: 'Member' }, roles: [{ name: 'Member' }] }] },
              },
            ],
            listMetadata: { before: null, after: 'om_1' },
          },
        },
      }),
      () => runMembershipList({ org: 'org_1' }),
    );
    const apiKey = await viaApiKey(
      {
        'GET /organizations/org_1': REST_ORG,
        'GET /user_management/organization_memberships': restList([REST_MEMBERSHIP], 'om_1'),
        'GET /authorization/roles': { object: 'list', data: [REST_ROLE_MEMBER] },
      },
      () => runMembershipList({ org: 'org_1' }),
    );
    expectParity('membership', session, apiKey);
  });

  it('session list matches with an API key', async () => {
    const session = await viaSession(
      () => ({
        userlandUser: {
          id: 'user_1',
          sessions: { data: [GQL_SESSION], listMetadata: { before: null, after: 'session_1' } },
        },
      }),
      () => runSessionList('user_1', {}),
    );
    const apiKey = await viaApiKey(
      {
        'GET /user_management/users/user_1/sessions': restList([REST_SESSION], 'session_1'),
        'GET /organizations/org_1': REST_ORG,
      },
      () => runSessionList('user_1', {}),
    );
    expectParity('session', session, apiKey);
    expect(apiKey).toMatchObject({ sessions: [{ state: 'active', provider: 'Password' }] });
  });

  it('webhook list matches with an API key', async () => {
    const session = await viaSession(
      () => ({ webhookEndpoints: { data: [GQL_ENDPOINT], listMetadata: { before: null, after: null } } }),
      () => runWebhookList({}),
    );
    const apiKey = await viaApiKey({ 'GET /webhook_endpoints': restList([REST_ENDPOINT]) }, () => runWebhookList({}));
    expectParity('webhook', session, apiKey);
    expect(apiKey).toMatchObject({ webhookEndpoints: [{ state: 'active' }] });
  });

  it('disabled webhook endpoints match with an API key (dashboard InActive, REST disabled)', async () => {
    const session = await viaSession(
      () => ({
        webhookEndpoints: {
          data: [{ ...GQL_ENDPOINT, state: 'InActive' }],
          listMetadata: { before: null, after: null },
        },
      }),
      () => runWebhookList({}),
    );
    const apiKey = await viaApiKey(
      { 'GET /webhook_endpoints': restList([{ ...REST_ENDPOINT, status: 'disabled' }]) },
      () => runWebhookList({}),
    );
    expectParity('webhook', session, apiKey);
    expect(apiKey).toMatchObject({ webhookEndpoints: [{ state: 'in_active' }] });
  });

  it('session providers match with an API key, and an unnamed OAuth provider is a documented null', async () => {
    const gqlSessions = [
      { ...GQL_SESSION, id: 'session_magic', provider: 'MagicAuth' },
      { ...GQL_SESSION, id: 'session_sso', provider: 'SingleSignOn' },
      { ...GQL_SESSION, id: 'session_oauth', provider: 'GoogleOAuth' },
    ];
    const restSessions = [
      { ...REST_SESSION, id: 'session_magic', auth_method: 'magic_code' },
      { ...REST_SESSION, id: 'session_sso', auth_method: 'sso' },
      { ...REST_SESSION, id: 'session_oauth', auth_method: 'oauth' },
    ];
    const session = await viaSession(
      () => ({
        userlandUser: { id: 'user_1', sessions: { data: gqlSessions, listMetadata: { before: null, after: null } } },
      }),
      () => runSessionList('user_1', {}),
    );
    const apiKey = await viaApiKey(
      {
        'GET /user_management/users/user_1/sessions': restList(restSessions),
        'GET /organizations/org_1': REST_ORG,
      },
      () => runSessionList('user_1', {}),
    );
    expectParity('session', session, apiKey);
    expect(apiKey).toMatchObject({
      sessions: [{ provider: 'MagicAuth' }, { provider: 'SingleSignOn' }, { provider: null }],
    });
  });

  it('event list matches with an API key, newest first with the same cursor contract', async () => {
    const session = await viaSession(
      () => ({ environment: { events: { data: [GQL_EVENT], listMetadata: { before: 'event_0', after: null } } } }),
      () => runEventList({ events: ['user.created'] }),
    );
    const apiKey = await viaApiKey({ 'GET /events': restList([REST_EVENT], 'event_0') }, () =>
      runEventList({ events: ['user.created'] }),
    );
    expectParity('event', session, apiKey, ['updatedAt']);
    expect(rest.callsTo('GET /events')[0].query).toMatchObject({ events: 'user.created', order: 'desc' });
  });

  it('feature-flag list and get match with an API key', async () => {
    const router = (doc: string) =>
      doc.includes('flagsForProject')
        ? { flagsForProject: { data: [GQL_FLAG], listMetadata: { before: null, after: null } } }
        : { flagBySlug: GQL_FLAG };
    const routes = { 'GET /feature-flags': restList([REST_FLAG]), 'GET /feature-flags/beta': REST_FLAG };

    expectParity(
      'feature-flag',
      await viaSession(router, () => runFeatureFlagList({})),
      await viaApiKey(routes, () => runFeatureFlagList({})),
    );
    expectParity(
      'feature-flag',
      await viaSession(router, () => runFeatureFlagGet('beta')),
      await viaApiKey(routes, () => runFeatureFlagGet('beta')),
      ['accessType', 'organizationTargets', 'userTargets'],
    );
  });

  it('org-domain get matches with an API key', async () => {
    const session = await viaSession(
      () => ({
        organizations: { data: [{ id: 'org_1', domains: [GQL_DOMAIN] }], listMetadata: { before: null, after: null } },
      }),
      () => runOrgDomainGet('dom_1', {}),
    );
    const apiKey = await viaApiKey({ 'GET /organizations': restList([REST_ORG]) }, () => runOrgDomainGet('dom_1', {}));
    // The DNS challenge (`workos-verify=abc123`) comes through; only the capture flag has no REST source.
    expectParity('org-domain', session, apiKey, ['domainCaptureEnabled']);
    expect(apiKey).toMatchObject({
      domain: { verificationContent: 'workos-verify=abc123', verificationStrategy: 'dns' },
    });
  });

  it('org-domain verify returns the dashboard’s DNS challenge with an API key', async () => {
    const pendingDomain = { ...GQL_DOMAIN, state: 'Pending' };
    const restPending = { ...REST_ORG.domains[0], state: 'pending' };
    const session = await viaSession(
      () => ({ restartOrganizationDomainVerification: pendingDomain }),
      () => runOrgDomainVerify('dom_1', {}),
    );
    const apiKey = await viaApiKey({ 'POST /organization_domains/dom_1/verify': restPending }, () =>
      runOrgDomainVerify('dom_1', {}),
    );
    expectParity('org-domain', session, apiKey, ['domainCaptureEnabled']);
    expect(apiKey).toEqual({
      domain: {
        id: 'dom_1',
        domain: 'foo.com',
        state: 'pending',
        organizationId: null,
        subdomain: null,
        verificationStrategy: 'dns',
        verificationContent: 'workos-verify=abc123',
        domainCaptureEnabled: null,
      },
    });
  });

  it('org-domain verify uses the dashboard’s default record prefix when REST has none, with an API key', async () => {
    const session = await viaSession(
      () => ({
        restartOrganizationDomainVerification: { ...GQL_DOMAIN, verificationContent: 'verification_token=tok_9' },
      }),
      () => runOrgDomainVerify('dom_1', {}),
    );
    const apiKey = await viaApiKey(
      {
        'POST /organization_domains/dom_1/verify': {
          ...REST_ORG.domains[0],
          verification_prefix: null,
          verification_token: 'tok_9',
        },
      },
      () => runOrgDomainVerify('dom_1', {}),
    );
    expectParity('org-domain', session, apiKey, ['domainCaptureEnabled']);
    expect(apiKey).toMatchObject({ domain: { verificationContent: 'verification_token=tok_9' } });
  });

  it('portal generate-link matches with an API key', async () => {
    const session = await viaSession(
      () => ({
        generatePortalSetupLink: {
          __typename: 'PortalSetupLinkGenerated',
          portalSetupLink: {
            id: 'psl_1',
            url: 'https://setup.workos.com/x',
            intents: ['Sso'],
            state: 'Active',
            expiresAt: T1,
          },
        },
      }),
      () => runPortalGenerateLink({ intent: 'sso', organization: 'org_1' }),
    );
    const apiKey = await viaApiKey({ 'POST /portal/generate_link': { link: 'https://setup.workos.com/x' } }, () =>
      runPortalGenerateLink({ intent: 'sso', organization: 'org_1' }),
    );
    expectParity('portal', session, apiKey, ['id', 'state', 'expiresAt']);
    expect(rest.callsTo('POST /portal/generate_link')[0].body).toEqual({ organization: 'org_1', intent: 'sso' });
  });
});

describe('apiKeyParityDiffs, the shared session-vs-key parity gate', () => {
  const sessionUser = {
    id: 'user_1',
    email: 'jane@example.com',
    authenticationFactors: [{ id: 'auth_factor_1', lastVerifiedAt: T1 }],
  };
  const sessionRow = {
    id: 'session_1',
    provider: 'Password',
    impersonator: { id: 'user_admin', email: 'admin@example.com', firstName: 'Ada', lastName: 'Admin' },
  };

  it('accepts only documented null leaves with an API key', () => {
    expect(
      apiKeyParityDiffs('user', sessionUser, {
        ...sessionUser,
        authenticationFactors: [{ id: 'auth_factor_1', lastVerifiedAt: null }],
      }),
    ).toEqual([]);
    expect(
      apiKeyParityDiffs('session', sessionRow, {
        ...sessionRow,
        impersonator: { id: null, email: 'admin@example.com', firstName: null, lastName: null },
      }),
    ).toEqual([]);
  });

  it('rejects an auth factor that lost its keys with an API key', () => {
    const diffs = apiKeyParityDiffs('user', sessionUser, { ...sessionUser, authenticationFactors: [{}] });
    expect(diffs.join('\n')).toContain('authenticationFactors[].id: present only on the session side');
  });

  it('rejects an impersonator that went null as a whole with an API key', () => {
    const diffs = apiKeyParityDiffs('session', sessionRow, { ...sessionRow, impersonator: null });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain('impersonator');
  });

  it('compares metadata keys named like pagination cursors with an API key', () => {
    const org = { id: 'org_1', metadata: { before: 'v1', after: 'v2', pagination: 'v3' } };

    expect(apiKeyParityDiffs('organization', org, org)).toEqual([]);
    expect(
      apiKeyParityDiffs('organization', org, { id: 'org_1', metadata: { before: 'changed', after: 'v2' } }),
    ).toEqual([
      'metadata.before: session="v1" apiKey="changed"',
      'metadata.pagination: present only on the session side',
    ]);
    expect(apiKeyParityDiffs('organization', [org], [{ ...org, metadata: { ...org.metadata, after: null } }])).toEqual([
      'metadata.after: session="v2" apiKey=null',
    ]);
    // The gate takes no exemption set any more (parity-smoke used to pass the
    // cursor names, which skipped them at every depth): an extra argument
    // must change nothing.
    const gate = apiKeyParityDiffs as unknown as (...args: unknown[]) => string[];
    const changed = { ...org, metadata: { ...org.metadata, before: 'changed' } };
    expect(gate('organization', org, changed, new Set(['before']))).toEqual([
      'metadata.before: session="v1" apiKey="changed"',
    ]);
  });

  it('rejects a lost email, a lost ID and a casing-only difference with an API key', () => {
    expect(
      apiKeyParityDiffs('session', sessionRow, {
        ...sessionRow,
        impersonator: { id: null, email: null, firstName: null, lastName: null },
      }),
    ).toEqual([expect.stringContaining('impersonator.email')]);
    expect(apiKeyParityDiffs('user', [sessionUser], [{ ...sessionUser, id: undefined }])).not.toEqual([]);
    expect(apiKeyParityDiffs('session', sessionRow, { ...sessionRow, provider: 'password' })).toEqual([
      expect.stringContaining('provider'),
    ]);
  });
});
