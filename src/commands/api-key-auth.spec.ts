/**
 * The API-key path for environment-scoped resource commands: when it is
 * chosen (unclaimed profile, WORKOS_API_KEY, --api-key), that signed-in users
 * keep the dashboard session otherwise, and that each command's mutations hit
 * the right REST endpoints with the key. Output parity lives in
 * api-key-parity.spec.ts.
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
const { CliExit } = await import('../utils/cli-exit.js');
const { formatWorkOSCommand } = await import('../utils/command-invocation.js');
const { setResourceApiKeyFlag } = await import('../lib/resource-auth.js');
const { API_KEY_UNSUPPORTED, apiKeyUnsupportedMessage } = await import('../lib/api-key-operations/index.js');
const { LEAK_PATTERN } = await import('../catalog/curation.js');
const { runOrgList, runOrgGet, runOrgCreate, runOrgUpdate, runOrgDelete } = await import('./organization.js');
const { runUserUpdate, runUserDelete } = await import('./user.js');
const { runRoleCreate, runRoleUpdate, runRoleSetPermissions, runRoleDelete } = await import('./role.js');
const { runPermissionList, runPermissionGet, runPermissionCreate, runPermissionUpdate, runPermissionDelete } =
  await import('./permission.js');
const { runMembershipList, runMembershipCreate, runMembershipUpdate, runMembershipDelete, runMembershipDeactivate } =
  await import('./membership.js');
const { runInvitationList, runInvitationSend, runInvitationRevoke } = await import('./invitation.js');
const { runSessionList, runSessionRevoke } = await import('./session.js');
const { runWebhookList, runWebhookCreate, runWebhookDelete } = await import('./webhook.js');
const { runFeatureFlagList, runFeatureFlagEnable, runFeatureFlagAddTarget, runFeatureFlagRemoveTarget } =
  await import('./feature-flag.js');
const { runOrgDomainCreate, runOrgDomainVerify, runOrgDomainDelete } = await import('./org-domain.js');
const { runConfigRedirectAdd, runConfigCorsAdd, runConfigHomepageUrlSet } = await import('./config.js');
const { runAuthkitCorsSet, runAuthkitRedirectUrisSet, runAuthkitRedirectUrisList, runAuthkitLogoutUrisList } =
  await import('./authkit.js');
const { runBrandingGet } = await import('./branding.js');
const { runEnvironmentRename } = await import('./environment.js');
const { runTeamMembers } = await import('./team.js');

const rest = createRestMock();

const T0 = '2026-01-01T00:00:00.000Z';
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
      created_at: T0,
      updated_at: T0,
    },
  ],
  metadata: {},
  external_id: null,
  created_at: T0,
  updated_at: T0,
};
const REST_ROLE = (overrides: Record<string, unknown> = {}) => ({
  object: 'role',
  id: 'role_admin',
  name: 'Admin',
  slug: 'admin',
  description: 'Administrator',
  type: 'EnvironmentRole',
  resource_type_slug: 'organization',
  permissions: ['users:read'],
  created_at: T0,
  updated_at: T0,
  ...overrides,
});
const REST_PERMISSION = {
  object: 'permission',
  id: 'perm_1',
  slug: 'users:read',
  name: 'Read users',
  description: 'Read user records',
  system: false,
  resource_type_slug: 'organization',
  created_at: T0,
  updated_at: T0,
};
const REST_MEMBERSHIP = {
  object: 'organization_membership',
  id: 'om_1',
  user_id: 'user_1',
  organization_id: 'org_1',
  organization_name: 'FooCorp',
  status: 'active',
  role: { slug: 'member' },
  roles: [{ slug: 'member' }],
  created_at: T0,
  updated_at: T0,
};

const UNCLAIMED_PROFILE = {
  name: 'unclaimed',
  type: 'unclaimed',
  apiKey: 'sk_test_unclaimed',
  clientId: 'client_1',
  claimToken: 'claim_1',
};
const CLAIMED_PROFILE = { name: 'sandbox', type: 'sandbox', apiKey: 'sk_stored', environmentId: 'env_profile' };

const TEAM_PROJECTS_PAYLOAD = {
  currentTeam: {
    projectsV2: [{ id: 'proj_1', environments: [{ id: 'env_profile', name: 'Sandbox', sandbox: true }] }],
  },
};

let stdout: string[];
let stderr: string[];

function useProfile(profile: Record<string, unknown>): void {
  mockGetActiveEnvironment.mockReturnValue(profile);
  mockGetConfig.mockReturnValue({
    activeEnvironment: profile.name,
    environments: { [profile.name as string]: profile },
  });
}

async function json(run: () => Promise<void>): Promise<Record<string, unknown>> {
  stdout = [];
  await run();
  return JSON.parse(stdout[stdout.length - 1]);
}

async function expectExit(run: () => Promise<void>): Promise<{ code: string; message: string; exitCode: number }> {
  stderr = [];
  try {
    await run();
  } catch (err) {
    if (err instanceof CliExit) {
      const payload = JSON.parse(stderr[stderr.length - 1]) as { error: { code: string; message: string } };
      return { ...payload.error, exitCode: err.exitCode };
    }
    throw err;
  }
  throw new Error('Expected CliExit but the command resolved');
}

describe('resource commands with an API key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInteractionModeForTests();
    setOutputMode('json');
    setResourceApiKeyFlag(undefined);
    vi.stubGlobal('fetch', rest.fetchMock);
    vi.stubEnv('WORKOS_API_KEY', '');
    vi.stubEnv('WORKOS_API_URL', '');
    vi.stubEnv('WORKOS_API_BASE_URL', '');
    rest.respond({});
    mockRequireCommandToken.mockResolvedValue('tok_session');
    mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
      if (String(doc).includes('teamProjectsV2')) return TEAM_PROJECTS_PAYLOAD;
      return { organizations: { data: [], listMetadata: { before: null, after: null } } };
    });
    useProfile(CLAIMED_PROFILE);
    stdout = [];
    stderr = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    setResourceApiKeyFlag(undefined);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetInteractionModeForTests();
    setOutputMode('human');
  });

  describe('choosing the path', () => {
    it('runs on REST with an API key from an unclaimed active profile, without a session', async () => {
      useProfile(UNCLAIMED_PROFILE);
      mockRequireCommandToken.mockRejectedValue(new Error('no session'));
      rest.respond({ 'GET /organizations': restList([REST_ORG]) });

      const out = await json(() => runOrgList({}));

      expect(out).toMatchObject({ organizations: [{ id: 'org_1', name: 'FooCorp' }] });
      expect(rest.callsTo('GET /organizations')[0].authorization).toBe('Bearer sk_test_unclaimed');
      expect(mockRequireCommandToken).not.toHaveBeenCalled();
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('runs on REST with an API key in WORKOS_API_KEY even when signed in', async () => {
      vi.stubEnv('WORKOS_API_KEY', 'sk_test_env');
      rest.respond({ 'GET /organizations': restList([REST_ORG]) });

      await json(() => runOrgList({}));

      expect(rest.callsTo('GET /organizations')[0].authorization).toBe('Bearer sk_test_env');
      expect(mockRequireCommandToken).not.toHaveBeenCalled();
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('lets an API key from --api-key win over WORKOS_API_KEY and the unclaimed profile', async () => {
      useProfile(UNCLAIMED_PROFILE);
      vi.stubEnv('WORKOS_API_KEY', 'sk_test_env');
      setResourceApiKeyFlag('sk_test_flag');
      rest.respond({ 'GET /organizations/org_1': REST_ORG });

      await json(() => runOrgGet('org_1'));

      expect(rest.callsTo('GET /organizations/org_1')[0].authorization).toBe('Bearer sk_test_flag');
    });

    it('keeps signed-in users on the dashboard session without an API key, ignoring a claimed profile’s stored key', async () => {
      await json(() => runOrgList({}));

      expect(mockRequireCommandToken).toHaveBeenCalledOnce();
      expect(mockGraphqlRequest).toHaveBeenCalled();
      expect(rest.calls).toHaveLength(0);
    });

    it('refuses --environment-id with an API key, since the key picks the environment', async () => {
      vi.stubEnv('WORKOS_API_KEY', 'sk_test_env');

      const error = await expectExit(() => runOrgList({ environmentId: 'env_profile' }));

      expect(error).toMatchObject({ code: 'invalid_argument', exitCode: 1 });
      expect(error.message).toContain('--environment-id cannot be combined with an API key');
      expect(rest.calls).toHaveLength(0);
    });

    it('explains the unclaimed profile when --environment-id is passed with an API key from it', async () => {
      useProfile(UNCLAIMED_PROFILE);

      const error = await expectExit(() => runOrgList({ environmentId: 'env_profile' }));

      expect(error.code).toBe('invalid_argument');
      expect(error.message).toContain('unclaimed environment');
      expect(error.message).toContain(formatWorkOSCommand('profile switch'));
    });

    it('keeps account-plane commands on the dashboard session with an API key set', async () => {
      vi.stubEnv('WORKOS_API_KEY', 'sk_test_env');
      mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
        const text = String(doc);
        if (text.includes('teamProjectsV2')) return TEAM_PROJECTS_PAYLOAD;
        if (text.includes('renameEnvironment'))
          return { renameEnvironment: { environment: { id: 'env_profile', name: 'Renamed' } } };
        return { currentTeam: { memberships: [] } };
      });

      await json(() => runEnvironmentRename({ environmentId: 'env_profile', name: 'Renamed' }));
      await json(() => runTeamMembers());

      expect(mockRequireCommandToken).toHaveBeenCalledTimes(2);
      expect(rest.calls).toHaveLength(0);
    });
  });

  describe('unsupported with an API key', () => {
    beforeEach(() => {
      vi.stubEnv('WORKOS_API_KEY', 'sk_test_env');
    });

    it('fails branding get with a structured error naming what is missing with an API key', async () => {
      const error = await expectExit(() => runBrandingGet({}));

      expect(error.code).toBe('api_key_unsupported');
      expect(error.message).toContain('branding images have no WorkOS API endpoint');
      expect(error.message).toContain(formatWorkOSCommand('auth login'));
      expect(rest.calls).toHaveLength(0);
    });

    it('fails authkit logout-uris with a structured error with an API key', async () => {
      const error = await expectExit(() => runAuthkitLogoutUrisList({}));

      expect(error.code).toBe('api_key_unsupported');
      expect(error.message).toContain('sign-out redirect URIs');
    });

    it('keeps every unsupported-with-an-API-key message free of internal terms', async () => {
      const messages = Object.values(API_KEY_UNSUPPORTED).map(apiKeyUnsupportedMessage);
      messages.push((await expectExit(() => runBrandingGet({}))).message);
      vi.stubEnv('WORKOS_API_KEY', 'sk_test_env');
      messages.push((await expectExit(() => runOrgList({ environmentId: 'env_x' }))).message);
      for (const message of messages) expect(LEAK_PATTERN.test(message), message).toBe(false);
    });

    it('refuses --dry-run before any write with an API key', async () => {
      const error = await expectExit(() =>
        runAuthkitRedirectUrisSet({ uris: ['https://a.example.com/cb'], dryRun: true }),
      );

      expect(error.code).toBe('api_key_unsupported');
      expect(error.message).toContain('--dry-run');
      expect(rest.calls).toHaveLength(0);
    });

    it('refuses to drop CORS origins (no REST delete) before any write with an API key', async () => {
      rest.respond({
        'GET /user_management/cors_origins': restList([
          { object: 'cors_origin', id: 'cors_1', origin: 'https://old.example.com' },
        ]),
      });

      const error = await expectExit(() => runAuthkitCorsSet({ origins: ['https://new.example.com'] }));

      expect(error.code).toBe('api_key_unsupported');
      expect(error.message).toContain('https://old.example.com');
      expect(rest.callsTo('POST /user_management/cors_origins')).toHaveLength(0);
    });
  });

  describe('REST requests with an API key', () => {
    beforeEach(() => {
      vi.stubEnv('WORKOS_API_KEY', 'sk_test_env');
    });

    it('maps a REST 404 to the command’s not_found error with an API key', async () => {
      const error = await expectExit(() => runOrgGet('org_missing'));

      expect(error.code).toBe('not_found');
      expect(error.message).toContain('org_missing');
    });

    it('keeps the API’s own not-found message for other 404s with an API key', async () => {
      rest.respond({
        'PUT /organizations/org_missing': { status: 404, body: { message: "Organization not found: 'org_missing'." } },
      });

      const error = await expectExit(() => runOrgUpdate('org_missing', 'Name'));

      expect(error).toMatchObject({ code: 'not_found', message: "Organization not found: 'org_missing'." });
    });

    it('reports a rejected key as a structured error with an API key', async () => {
      rest.respond({ 'GET /organizations': { status: 401, body: { message: 'Unauthorized' } } });

      const error = await expectExit(() => runOrgList({}));

      expect(error.code).toBe('http_401');
      expect(error.message).toContain('Invalid API key');
    });

    it('creates, updates and deletes organizations with an API key', async () => {
      rest.respond({
        'POST /organizations': REST_ORG,
        'PUT /organizations/org_1': { ...REST_ORG, name: 'Renamed' },
        'DELETE /organizations/org_1': { status: 204 },
      });

      const created = await json(() => runOrgCreate('FooCorp', ['foo.com:pending']));
      const updated = await json(() => runOrgUpdate('org_1', 'Renamed'));
      const deleted = await json(() => runOrgDelete('org_1', { yes: true }));

      expect(rest.callsTo('POST /organizations')[0].body).toEqual({
        name: 'FooCorp',
        domain_data: [{ domain: 'foo.com', state: 'pending' }],
      });
      expect(rest.callsTo('PUT /organizations/org_1')[0].body).toEqual({ name: 'Renamed' });
      expect(created).toMatchObject({ organization: { id: 'org_1', domains: [{ id: 'dom_1', state: 'verified' }] } });
      expect(updated).toMatchObject({ organization: { name: 'Renamed' } });
      expect(deleted).toEqual({ deleted: 'org_1' });
    });

    it('updates and deletes users with snake_case bodies with an API key', async () => {
      rest.respond({
        'PUT /user_management/users/user_1': {
          object: 'user',
          id: 'user_1',
          email: 'j@example.com',
          first_name: 'Jo',
          last_name: 'Doe',
        },
        'DELETE /user_management/users/user_1': { status: 204 },
      });

      const updated = await json(() => runUserUpdate('user_1', { firstName: 'Jo', externalId: 'ext_9' }));
      const deleted = await json(() => runUserDelete('user_1', { yes: true }));

      expect(rest.callsTo('PUT /user_management/users/user_1')[0].body).toEqual({
        first_name: 'Jo',
        external_id: 'ext_9',
      });
      expect(updated).toEqual({ user: { id: 'user_1', email: 'j@example.com', firstName: 'Jo', lastName: 'Doe' } });
      expect(deleted).toEqual({ deleted: 'user_1' });
    });

    it('reports a missing user as not_found on delete with an API key', async () => {
      const error = await expectExit(() => runUserDelete('user_missing', { yes: true }));
      expect(error.code).toBe('not_found');
    });

    it('creates and updates roles by slug, replacing permissions, with an API key', async () => {
      rest.respond({
        'POST /authorization/roles': REST_ROLE({ id: 'role_new', slug: 'auditor', name: 'Auditor', permissions: [] }),
        'GET /authorization/roles': { object: 'list', data: [REST_ROLE()] },
        'PATCH /authorization/roles/admin': REST_ROLE({ name: 'Administrators' }),
        'PUT /authorization/roles/admin/permissions': REST_ROLE({ permissions: ['users:read', 'users:write'] }),
      });

      const created = await json(() => runRoleCreate({ slug: 'auditor', name: 'Auditor', yes: true }));
      const updated = await json(() => runRoleUpdate('admin', { name: 'Administrators', yes: true }));
      const set = await json(() => runRoleSetPermissions('admin', ['users:read', 'users:write'], { yes: true }));

      expect(rest.callsTo('POST /authorization/roles')[0].body).toEqual({ slug: 'auditor', name: 'Auditor' });
      expect(created).toMatchObject({ role: { slug: 'auditor', type: 'environment' } });
      expect(rest.callsTo('PATCH /authorization/roles/admin')[0].body).toEqual({
        name: 'Administrators',
        description: 'Administrator',
      });
      expect(updated).toMatchObject({ role: { name: 'Administrators', permissions: ['users:read'] } });
      expect(rest.callsTo('PUT /authorization/roles/admin/permissions')[0].body).toEqual({
        permissions: ['users:read', 'users:write'],
      });
      expect(set).toMatchObject({ role: { permissions: ['users:read', 'users:write'] } });
    });

    it('never reports permissions it failed to set when the replace returns 404 with an API key', async () => {
      rest.respond({
        'GET /authorization/roles': { object: 'list', data: [REST_ROLE()] },
        'PATCH /authorization/roles/admin': REST_ROLE(),
        // The replace fails; the old role (still holding users:read) must not be reported as updated.
        'PUT /authorization/roles/admin/permissions': { status: 404, body: { message: 'Role not found' } },
        'GET /authorization/roles/admin': REST_ROLE(),
      });

      const error = await expectExit(() => runRoleSetPermissions('admin', [], { yes: true }));

      expect(error.code).toBe('not_found');
      expect(stdout).toHaveLength(0);
      expect(rest.callsTo('GET /authorization/roles/admin')).toHaveLength(0);
    });

    it('refuses to report success when the server holds other permissions afterwards with an API key', async () => {
      rest.respond({
        'GET /authorization/roles': { object: 'list', data: [REST_ROLE()] },
        'PATCH /authorization/roles/admin': REST_ROLE(),
        'PUT /authorization/roles/admin/permissions': REST_ROLE({ permissions: ['users:read'] }),
      });

      const error = await expectExit(() => runRoleSetPermissions('admin', ['users:write'], { yes: true }));

      expect(error.code).toBe('unexpected_result');
      expect(error.message).toContain('did not change as requested');
      expect(stdout).toHaveLength(0);
    });

    it('reads the role back after an empty-bodied permissions replace with an API key', async () => {
      let replaced = false;
      rest.respond({
        'GET /authorization/roles': { object: 'list', data: [REST_ROLE()] },
        'PATCH /authorization/roles/admin': REST_ROLE(),
        'PUT /authorization/roles/admin/permissions': () => {
          replaced = true;
          return { status: 204 };
        },
        'GET /authorization/roles/admin': () => REST_ROLE({ permissions: replaced ? ['users:write'] : ['users:read'] }),
      });

      const out = await json(() => runRoleSetPermissions('admin', ['users:write'], { yes: true }));

      expect(out).toMatchObject({ role: { slug: 'admin', permissions: ['users:write'] } });
      expect(rest.callsTo('GET /authorization/roles/admin')).toHaveLength(1);
    });

    it('reports an existing slug as already_exists on role create with an API key', async () => {
      rest.respond({
        'POST /authorization/roles': { status: 409, body: { message: 'exists', code: 'role_slug_already_exists' } },
      });

      const error = await expectExit(() => runRoleCreate({ slug: 'admin', name: 'Admin', yes: true }));
      expect(error.code).toBe('already_exists');
    });

    it('deletes an organization role through the organization scope with an API key', async () => {
      rest.respond({
        'GET /authorization/organizations/org_1/roles': {
          object: 'list',
          data: [REST_ROLE(), REST_ROLE({ id: 'role_org', slug: 'billing', type: 'OrganizationRole' })],
        },
        'DELETE /authorization/organizations/org_1/roles/billing': { status: 204 },
      });

      const out = await json(() => runRoleDelete('billing', { org: 'org_1', yes: true }));

      expect(out).toEqual({ deleted: 'billing' });
      expect(rest.callsTo('DELETE /authorization/organizations/org_1/roles/billing')).toHaveLength(1);
    });

    it('creates, updates and deletes permissions by slug with an API key', async () => {
      rest.respond({
        'POST /authorization/permissions': REST_PERMISSION,
        'GET /authorization/permissions': restList([REST_PERMISSION]),
        'PATCH /authorization/permissions/users:read': { ...REST_PERMISSION, name: 'View users' },
        'DELETE /authorization/permissions/users:read': { status: 204 },
      });

      await json(() => runPermissionCreate({ slug: 'users:read', name: 'Read users', yes: true }));
      const updated = await json(() => runPermissionUpdate('users:read', { name: 'View users', yes: true }));
      const deleted = await json(() => runPermissionDelete('users:read', { yes: true }));

      expect(updated).toMatchObject({ permission: { slug: 'users:read', name: 'View users' } });
      expect(deleted).toEqual({ deleted: 'users:read' });
    });

    it('resolves role IDs to slugs for memberships and invitations with an API key', async () => {
      rest.respond({
        'GET /authorization/roles': {
          object: 'list',
          data: [REST_ROLE({ id: 'role_member', slug: 'member', name: 'Member' })],
        },
        'POST /user_management/organization_memberships': REST_MEMBERSHIP,
        'GET /user_management/organization_memberships/om_1': REST_MEMBERSHIP,
        'PUT /user_management/organization_memberships/om_1': REST_MEMBERSHIP,
        'POST /user_management/invitations': {
          object: 'invitation',
          id: 'invitation_1',
          email: 'n@example.com',
          state: 'pending',
        },
      });

      const added = await json(() => runMembershipCreate({ org: 'org_1', user: 'user_1', role: 'role_member' }));
      const updated = await json(() => runMembershipUpdate('om_1', { role: 'role_member', yes: true }));
      const invited = await json(() =>
        runInvitationSend({ email: 'n@example.com', org: 'org_1', role: 'role_member' }),
      );

      expect(rest.callsTo('POST /user_management/organization_memberships')[0].body).toEqual({
        organization_id: 'org_1',
        user_id: 'user_1',
        role_slug: 'member',
      });
      expect(added).toEqual({ added: { organizationId: 'org_1', userId: 'user_1' } });
      expect(rest.callsTo('PUT /user_management/organization_memberships/om_1')[0].body).toEqual({
        role_slug: 'member',
      });
      expect(updated).toMatchObject({ membership: { id: 'om_1', role: 'member', state: 'active' } });
      expect(rest.callsTo('POST /user_management/invitations')[0].body).toEqual({
        email: 'n@example.com',
        expires_in_days: 7,
        organization_id: 'org_1',
        role_slug: 'member',
      });
      expect(invited).toEqual({ invitation: { id: 'invitation_1' } });
    });

    it('reports an unknown role ID as not_found on membership update with an API key', async () => {
      rest.respond({
        'GET /authorization/roles': { object: 'list', data: [] },
        'GET /authorization/organizations/org_1/roles': { object: 'list', data: [] },
        'GET /user_management/organization_memberships/om_1': REST_MEMBERSHIP,
      });

      const error = await expectExit(() => runMembershipUpdate('om_1', { role: 'role_nope', yes: true }));
      expect(error).toMatchObject({ code: 'not_found' });
      expect(error.message).toContain('role_nope');
    });

    it('deletes and deactivates memberships by ID with an API key', async () => {
      rest.respond({
        'GET /user_management/organization_memberships/om_1': REST_MEMBERSHIP,
        'GET /user_management/organization_memberships': restList([REST_MEMBERSHIP]),
        'DELETE /user_management/organization_memberships/om_1': { status: 204 },
        'PUT /user_management/organization_memberships/om_1/deactivate': REST_MEMBERSHIP,
      });

      const deleted = await json(() => runMembershipDelete('om_1', { yes: true }));
      const deactivated = await json(() => runMembershipDeactivate('om_1', { yes: true }));

      // The removal deletes the membership the command just resolved, by ID.
      expect(rest.callsTo('DELETE /user_management/organization_memberships/om_1')).toHaveLength(1);
      expect(deleted).toEqual({ deleted: 'om_1' });
      expect(deactivated).toEqual({ deactivated: 'om_1' });
    });

    it('deletes a deactivated membership by the ID it resolved with an API key', async () => {
      const inactive = { ...REST_MEMBERSHIP, id: 'om_inactive', user_id: 'user_2', status: 'inactive' };
      rest.respond({
        'GET /user_management/organization_memberships/om_inactive': inactive,
        // Like REST's default status filter, a search without statuses finds no inactive membership.
        'GET /user_management/organization_memberships': (call: { query: Record<string, string> }) =>
          restList(call.query.statuses?.includes('inactive') ? [inactive] : []),
        'DELETE /user_management/organization_memberships/om_inactive': { status: 204 },
      });

      const deleted = await json(() => runMembershipDelete('om_inactive', { yes: true }));

      expect(deleted).toEqual({ deleted: 'om_inactive' });
      expect(rest.callsTo('DELETE /user_management/organization_memberships/om_inactive')).toHaveLength(1);
    });

    it('lists memberships of every status, by user and by organization, with an API key', async () => {
      rest.respond({
        'GET /organizations/org_1': REST_ORG,
        'GET /user_management/organization_memberships': restList([{ ...REST_MEMBERSHIP, status: 'inactive' }]),
      });

      const byUser = await json(() => runMembershipList({ user: 'user_1' }));
      const byOrg = await json(() => runMembershipList({ org: 'org_1' }));

      const searches = rest.callsTo('GET /user_management/organization_memberships');
      expect(searches).toHaveLength(2);
      for (const search of searches) expect(search.query.statuses).toBe('active,inactive,pending');
      expect(byUser).toMatchObject({ memberships: [{ id: 'om_1', state: 'inactive' }] });
      expect(byOrg).toMatchObject({ memberships: [{ id: 'om_1', state: 'inactive' }] });
    });

    it('reads every page of permissions in an explicit order with an API key', async () => {
      const page = (from: number, count: number) =>
        Array.from({ length: count }, (_, i) => ({
          ...REST_PERMISSION,
          id: `perm_${from + i}`,
          slug: `p:${from + i}`,
          name: `Permission ${from + i}`,
        }));
      rest.respond({
        // Only an explicit order makes `after` the next page; without one the second page is never reached.
        'GET /authorization/permissions': (call: { query: Record<string, string> }) => {
          if (call.query.order !== 'desc') return restList(page(0, 100), null);
          return call.query.after === 'perm_99' ? restList(page(100, 5)) : restList(page(0, 100), 'perm_99');
        },
      });

      const listed = (await json(() => runPermissionList({}))) as { permissions: unknown[] };
      const got = await json(() => runPermissionGet('p:104'));

      expect(listed.permissions).toHaveLength(105);
      expect(got).toMatchObject({ permission: { slug: 'p:104' } });
      expect(rest.callsTo('GET /authorization/permissions').map((call) => call.query.after ?? null)).toEqual([
        null,
        'perm_99',
        null,
        'perm_99',
      ]);
    });

    it('revokes invitations and sessions with an API key', async () => {
      rest.respond({
        'POST /user_management/invitations/invitation_1/revoke': {
          object: 'invitation',
          id: 'invitation_1',
          state: 'revoked',
        },
        'POST /user_management/sessions/revoke': { status: 204 },
      });

      expect(await json(() => runInvitationRevoke('invitation_1', { yes: true }))).toEqual({ revoked: 'invitation_1' });
      expect(await json(() => runSessionRevoke('session_1', { yes: true }))).toEqual({ revoked: 'session_1' });
      expect(rest.callsTo('POST /user_management/sessions/revoke')[0].body).toEqual({ session_id: 'session_1' });
    });

    it('creates and deletes webhook endpoints with an API key', async () => {
      rest.respond({
        'POST /webhook_endpoints': {
          object: 'webhook_endpoint',
          id: 'we_1',
          endpoint_url: 'https://e.example.com',
          status: 'enabled',
        },
        'DELETE /webhook_endpoints/we_1': { status: 204 },
      });

      const created = await json(() => runWebhookCreate({ url: 'https://e.example.com', events: ['user.created'] }));
      const deleted = await json(() => runWebhookDelete('we_1', { yes: true }));

      expect(rest.callsTo('POST /webhook_endpoints')[0].body).toEqual({
        endpoint_url: 'https://e.example.com',
        events: ['user.created'],
      });
      expect(created).toEqual({
        webhookEndpoint: { id: 'we_1', url: 'https://e.example.com', events: ['user.created'] },
      });
      expect(deleted).toEqual({ deleted: 'we_1' });
    });

    it('enables flags and changes targets through the REST endpoints with an API key', async () => {
      const flag = {
        object: 'feature_flag',
        id: 'flag_1',
        slug: 'beta',
        name: 'Beta',
        enabled: false,
        default_value: false,
        tags: [],
      };
      rest.respond({
        'GET /feature-flags/beta': flag,
        'PUT /feature-flags/beta/enable': { ...flag, enabled: true },
        'POST /feature-flags/beta/targets/org_1': { status: 204 },
        'DELETE /feature-flags/beta/targets/user_1': { status: 204 },
      });

      expect(await json(() => runFeatureFlagEnable('beta'))).toEqual({ enabled: 'beta' });
      expect(await json(() => runFeatureFlagAddTarget('beta', 'org_1'))).toEqual({
        added: { flag: 'beta', targetId: 'org_1' },
      });
      expect(await json(() => runFeatureFlagRemoveTarget('beta', 'user_1'))).toEqual({
        removed: { flag: 'beta', targetId: 'user_1' },
      });
      // Each command makes exactly its own write, in order, and nothing else writes.
      expect(rest.calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.path}`)).toEqual([
        'PUT /feature-flags/beta/enable',
        'POST /feature-flags/beta/targets/org_1',
        'DELETE /feature-flags/beta/targets/user_1',
      ]);
      // No project lookup on the key path: the key is the environment.
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('adds, verifies and deletes organization domains with an API key', async () => {
      const domain = {
        object: 'organization_domain',
        id: 'dom_2',
        organization_id: 'org_1',
        domain: 'bar.com',
        state: 'pending',
        verification_strategy: 'dns',
      };
      rest.respond({
        'POST /organization_domains': domain,
        'POST /organization_domains/dom_2/verify': domain,
        'DELETE /organization_domains/dom_2': { status: 204 },
      });

      const created = await json(() => runOrgDomainCreate('bar.com', { org: 'org_1' }));
      const verified = await json(() => runOrgDomainVerify('dom_2'));
      const deleted = await json(() => runOrgDomainDelete('dom_2', { yes: true }));

      expect(rest.callsTo('POST /organization_domains')[0].body).toEqual({
        organization_id: 'org_1',
        domain: 'bar.com',
      });
      expect(created).toMatchObject({
        domain: { id: 'dom_2', state: 'pending', verificationStrategy: 'dns', organizationId: 'org_1' },
      });
      expect(verified).toMatchObject({ domain: { id: 'dom_2', domain: 'bar.com' } });
      expect(deleted).toEqual({ deleted: 'dom_2' });
    });

    it('adds replacement redirect URIs before deleting old ones, so a rejected URI deletes nothing, with an API key', async () => {
      const existing = { object: 'redirect_uri', id: 'ru_1', uri: 'https://a.example.com/cb', default: true };
      rest.respond({
        'GET /user_management/redirect_uris': restList([existing]),
        'POST /user_management/redirect_uris': {
          status: 422,
          body: { message: 'Invalid redirect URI', code: 'invalid_uri' },
        },
        'DELETE /user_management/redirect_uris/ru_1': { status: 204 },
      });

      const error = await expectExit(() => runAuthkitRedirectUrisSet({ uris: ['not-a-url'] }));

      expect(error.code).toBe('invalid_uri');
      expect(rest.callsTo('POST /user_management/redirect_uris')).toHaveLength(1);
      expect(rest.callsTo('DELETE /user_management/redirect_uris/ru_1')).toHaveLength(0);
    });

    it('replaces redirect URIs by adding first and deleting second with an API key', async () => {
      const oldUri = { object: 'redirect_uri', id: 'ru_1', uri: 'https://a.example.com/cb', default: false };
      const newUri = { object: 'redirect_uri', id: 'ru_2', uri: 'https://b.example.com/cb', default: false };
      let state = [oldUri];
      rest.respond({
        'GET /user_management/redirect_uris': () => restList(state),
        'POST /user_management/redirect_uris': () => {
          state = [...state, newUri];
          return newUri;
        },
        'DELETE /user_management/redirect_uris/ru_1': () => {
          state = state.filter((uri) => uri.id !== 'ru_1');
          return { status: 204 };
        },
      });

      const out = await json(() => runAuthkitRedirectUrisSet({ uris: ['https://b.example.com/cb'] }));

      const writes = rest.calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.path}`);
      expect(writes).toEqual(['POST /user_management/redirect_uris', 'DELETE /user_management/redirect_uris/ru_1']);
      expect(out).toEqual({
        redirectUris: [{ id: 'ru_2', uri: 'https://b.example.com/cb', isDefault: false }],
        dryRun: false,
      });
    });

    it('adds redirect URIs and CORS origins without rewriting the rest with an API key', async () => {
      const existing = { object: 'redirect_uri', id: 'ru_1', uri: 'https://a.example.com/cb', default: true };
      let created = false;
      let origins = [{ object: 'cors_origin', id: 'cors_1', origin: 'https://a.example.com' }];
      rest.respond({
        'GET /user_management/redirect_uris': () =>
          restList(
            created
              ? [existing, { object: 'redirect_uri', id: 'ru_2', uri: 'https://b.example.com/cb', default: false }]
              : [existing],
          ),
        'POST /user_management/redirect_uris': () => {
          created = true;
          return { object: 'redirect_uri', id: 'ru_2', uri: 'https://b.example.com/cb', default: false };
        },
        'GET /user_management/cors_origins': () => restList(origins),
        'POST /user_management/cors_origins': (call: { body: unknown }) => {
          const { origin } = call.body as { origin: string };
          const created = { object: 'cors_origin', id: `cors_${origins.length + 1}`, origin };
          origins = [...origins, created];
          return created;
        },
      });

      expect(await json(() => runConfigRedirectAdd('https://b.example.com/cb'))).toEqual({
        uri: 'https://b.example.com/cb',
        alreadyExists: false,
      });
      expect(await json(() => runConfigCorsAdd('https://b.example.com'))).toEqual({
        origin: 'https://b.example.com',
        alreadyExists: false,
      });
      expect(rest.callsTo('POST /user_management/redirect_uris').map((c) => c.body)).toEqual([
        { uri: 'https://b.example.com/cb' },
      ]);
      expect(rest.callsTo('DELETE /user_management/redirect_uris/ru_1')).toHaveLength(0);
      // Only the new origin is posted; the existing one is kept, not re-sent or dropped.
      expect(rest.callsTo('POST /user_management/cors_origins').map((c) => c.body)).toEqual([
        { origin: 'https://b.example.com' },
      ]);
      expect(origins.map((origin) => origin.origin)).toEqual(['https://a.example.com', 'https://b.example.com']);
      // Adding an origin that already exists writes nothing.
      expect(await json(() => runConfigCorsAdd('https://a.example.com'))).toEqual({
        origin: 'https://a.example.com',
        alreadyExists: true,
      });
      expect(rest.callsTo('POST /user_management/cors_origins')).toHaveLength(1);
    });

    it('refuses to add a redirect URI over a list longer than one page with an API key', async () => {
      const uris = Array.from({ length: 100 }, (_, i) => ({
        object: 'redirect_uri',
        id: `ru_${i}`,
        uri: `https://app.example.com/cb/${i}`,
        default: i === 0,
      }));
      rest.respond({
        // REST's default `normal` order puts the older-page cursor in `before`; only an
        // explicit `desc` puts it in `after`, which is what the merge guard checks.
        'GET /user_management/redirect_uris': (call: { query: Record<string, string> }) =>
          call.query.order === 'desc' ? restList(uris, 'ru_99') : restList(uris, null, 'ru_99'),
        'POST /user_management/redirect_uris': { object: 'redirect_uri', id: 'ru_new', uri: 'x', default: false },
      });

      const error = await expectExit(() => runConfigRedirectAdd('https://app.example.com/cb/new'));

      expect(error.code).toBe('too_many_uris');
      expect(rest.callsTo('GET /user_management/redirect_uris')[0].query).toMatchObject({
        limit: '100',
        order: 'desc',
      });
      expect(rest.calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
    });

    it('asks every paginated list for an explicit order so after is the next page with an API key', async () => {
      rest.respond({
        'GET /organizations': restList([]),
        'GET /user_management/invitations': restList([]),
        'GET /webhook_endpoints': restList([]),
        'GET /user_management/users/user_1/sessions': restList([]),
        'GET /feature-flags': restList([]),
        'GET /user_management/redirect_uris': restList([]),
      });

      await json(() => runOrgList({}));
      await json(() => runInvitationList({}));
      await json(() => runWebhookList({}));
      await json(() => runSessionList('user_1', {}));
      await json(() => runFeatureFlagList({}));
      await json(() => runAuthkitRedirectUrisList({}));
      await json(() => runOrgList({ order: 'asc' }));

      expect(rest.calls.map((call) => `${call.path} ${call.query.order}`)).toEqual([
        '/organizations desc',
        '/user_management/invitations desc',
        '/webhook_endpoints desc',
        '/user_management/users/user_1/sessions desc',
        '/feature-flags desc',
        '/user_management/redirect_uris desc',
        '/organizations asc',
      ]);
    });

    it('sets the homepage URL with a null applicationId with an API key', async () => {
      rest.respond({ 'PUT /user_management/app_homepage_url': { status: 204 } });

      const out = await json(() => runConfigHomepageUrlSet('https://app.example.com'));

      expect(rest.callsTo('PUT /user_management/app_homepage_url')[0].body).toEqual({ url: 'https://app.example.com' });
      expect(out).toEqual({ homepageUrl: 'https://app.example.com', applicationId: null });
    });
  });
});
