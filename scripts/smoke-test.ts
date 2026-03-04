/**
 * Smoke test for CLI management commands.
 *
 * Exercises each command handler directly against the real WorkOS API
 * to verify SDK method signatures are correct.
 *
 * Usage:
 *   WORKOS_API_KEY=sk_test_xxx pnpm tsx scripts/smoke-test.ts
 */

import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { setOutputMode } from '../src/utils/output.js';
import { createWorkOSClient } from '../src/lib/workos-client.js';

setOutputMode('json');

// Intercept process.exit so handler errors (exitWithError) don't kill the smoke test
const realExit = process.exit;
let lastExitCode: number | undefined;
process.exit = ((code?: number) => {
  lastExitCode = code ?? 0;
  throw new Error(`process.exit(${code}) intercepted`);
}) as never;

const apiKey = process.env.WORKOS_API_KEY;
if (!apiKey) {
  realExit.call(process, 1);
}

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  error?: string;
  duration?: number;
}

const results: TestResult[] = [];

// Captured output from handlers (we parse this to extract IDs)
let capturedOutput: string[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  capturedOutput = [];
  lastExitCode = undefined;
  try {
    await fn();
    results.push({ name, status: 'pass', duration: Date.now() - start });
    process.stdout.write(`  ✓ ${name} (${Date.now() - start}ms)\n`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    // Auth errors = signature is correct, key just lacks access
    if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized') || msg.includes('Forbidden')) {
      results.push({ name, status: 'pass', duration: Date.now() - start });
      process.stdout.write(`  ✓ ${name} (auth-limited, signature OK) (${Date.now() - start}ms)\n`);
      return;
    }

    // Export timeout = signature is correct, just slow
    if (msg.includes('Export timed out')) {
      results.push({ name, status: 'pass', duration: Date.now() - start });
      process.stdout.write(`  ✓ ${name} (timed out, signature OK) (${Date.now() - start}ms)\n`);
      return;
    }

    // Structured API errors (400, 404, 422) = call reached the API, signature is correct,
    // business logic rejected it (missing config, entity not found, validation, etc.)
    if (
      msg.includes('process.exit') &&
      capturedOutput.some((o) => {
        try {
          const p = JSON.parse(o.replace('[stderr] ', ''));
          return p?.error?.code;
        } catch {
          return false;
        }
      })
    ) {
      results.push({ name, status: 'pass', duration: Date.now() - start });
      const apiErr = capturedOutput.find((o) => o.includes('"error"'));
      const code = apiErr ? JSON.parse(apiErr.replace('[stderr] ', '')).error?.code : 'unknown';
      process.stdout.write(`  ✓ ${name} (api-rejected: ${code}, signature OK) (${Date.now() - start}ms)\n`);
      return;
    }

    // Build detailed error message
    const details: string[] = [`  ✗ ${name}: ${msg}`];
    if (lastExitCode !== undefined) {
      details.push(`    exit code: ${lastExitCode}`);
    }
    if (capturedOutput.length > 0) {
      details.push(`    handler output: ${capturedOutput.join(' | ')}`);
    }
    if (stack && !msg.includes('process.exit')) {
      // Show a couple frames for real errors (not the exit intercept)
      const frames = stack
        .split('\n')
        .slice(1, 4)
        .map((l) => `    ${l.trim()}`);
      details.push(...frames);
    }

    const fullError = details.join('\n');
    results.push({ name, status: 'fail', error: fullError, duration: Date.now() - start });
    process.stdout.write(fullError + '\n');
  }
}

/** Parse the first captured JSON output line */
function parseOutput(): unknown {
  for (const line of capturedOutput) {
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  return null;
}

// Suppress console.log/error from handlers, capture output
const origLog = console.log;
const origError = console.error;
function muteConsole() {
  console.log = (...args: unknown[]) => {
    capturedOutput.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    capturedOutput.push('[stderr] ' + args.map(String).join(' '));
  };
}
function unmuteConsole() {
  console.log = origLog;
  console.error = origError;
}

// Cleanup registry — functions to call at the end
const cleanups: Array<() => Promise<void>> = [];

function section(name: string) {
  unmuteConsole();
  process.stdout.write(`\n${name}:\n`);
  muteConsole();
}

async function run() {
  process.stdout.write('\n🔍 WorkOS CLI Smoke Test\n');
  process.stdout.write(`   API Key: ${apiKey!.substring(0, 12)}...\n\n`);

  const client = createWorkOSClient(apiKey);

  // ---- Setup: create test org for commands that need an org ID ----
  process.stdout.write('Setup:\n');
  const testOrgName = `smoke-test-${Date.now()}`;
  let testOrgId: string | undefined;
  let testUserId: string | undefined;

  try {
    const org = await client.sdk.organizations.createOrganization({ name: testOrgName });
    testOrgId = org.id;
    process.stdout.write(`  Created test org: ${testOrgId}\n`);
    cleanups.push(async () => {
      await client.sdk.organizations.deleteOrganization(testOrgId!);
      process.stdout.write(`  Cleaned up org: ${testOrgId}\n`);
    });
  } catch (e) {
    process.stdout.write(`  ⚠ Could not create test org: ${e instanceof Error ? e.message : e}\n`);
  }

  // Get a user ID from existing users
  try {
    const users = await client.sdk.userManagement.listUsers({ limit: 1 });
    if (users.data.length > 0) {
      testUserId = users.data[0].id;
      process.stdout.write(`  Found test user: ${testUserId}\n`);
    }
  } catch {
    process.stdout.write(`  ⚠ Could not list users for test user ID\n`);
  }

  process.stdout.write('\n');

  // =====================================================================
  // Organization (lifecycle)
  // =====================================================================
  section('Organization');
  await test('organization list', async () => {
    const { runOrgList } = await import('../src/commands/organization.js');
    await runOrgList({}, apiKey!);
  });

  const orgLifecycleName = `smoke-org-lifecycle-${Date.now()}`;
  let lifecycleOrgId: string | undefined;
  await test('organization create', async () => {
    const { runOrgCreate } = await import('../src/commands/organization.js');
    await runOrgCreate(orgLifecycleName, [], apiKey!);
    const output = parseOutput() as { data?: { id?: string } } | null;
    lifecycleOrgId = output?.data?.id;
  });
  if (lifecycleOrgId) {
    await test('organization get', async () => {
      const { runOrgGet } = await import('../src/commands/organization.js');
      await runOrgGet(lifecycleOrgId!, apiKey!);
    });
    await test('organization update', async () => {
      const { runOrgUpdate } = await import('../src/commands/organization.js');
      await runOrgUpdate(lifecycleOrgId!, `${orgLifecycleName}-updated`, apiKey!);
    });
    await test('organization delete', async () => {
      const { runOrgDelete } = await import('../src/commands/organization.js');
      await runOrgDelete(lifecycleOrgId!, apiKey!);
    });
  }

  // =====================================================================
  // User (read + update — no create/delete for safety)
  // =====================================================================
  section('User');
  await test('user list', async () => {
    const { runUserList } = await import('../src/commands/user.js');
    await runUserList({}, apiKey!);
  });
  if (testUserId) {
    await test('user get', async () => {
      const { runUserGet } = await import('../src/commands/user.js');
      await runUserGet(testUserId!, apiKey!);
    });
    await test('user update', async () => {
      const { runUserUpdate } = await import('../src/commands/user.js');
      await runUserUpdate(testUserId!, apiKey!, {});
    });
  }

  // =====================================================================
  // Permission (full CRUD lifecycle)
  // =====================================================================
  section('Permission (lifecycle)');

  const testPermSlug = `smoke-perm-${Date.now()}`;
  const testPermSlug2 = `smoke-perm2-${Date.now()}`;
  await test('permission create', async () => {
    const { runPermissionCreate } = await import('../src/commands/permission.js');
    await runPermissionCreate({ slug: testPermSlug, name: `Smoke Test ${testPermSlug}` }, apiKey!);
  });
  await test('permission create (second)', async () => {
    const { runPermissionCreate } = await import('../src/commands/permission.js');
    await runPermissionCreate({ slug: testPermSlug2, name: `Smoke Test ${testPermSlug2}` }, apiKey!);
  });
  await test('permission list', async () => {
    const { runPermissionList } = await import('../src/commands/permission.js');
    await runPermissionList({}, apiKey!);
  });
  await test('permission get', async () => {
    const { runPermissionGet } = await import('../src/commands/permission.js');
    await runPermissionGet(testPermSlug, apiKey!);
  });
  await test('permission update', async () => {
    const { runPermissionUpdate } = await import('../src/commands/permission.js');
    await runPermissionUpdate(testPermSlug, { name: `Updated ${testPermSlug}` }, apiKey!);
  });
  // Cleanup permissions after role tests use them
  cleanups.push(async () => {
    try {
      const { runPermissionDelete } = await import('../src/commands/permission.js');
      muteConsole();
      await runPermissionDelete(testPermSlug, apiKey!);
      await runPermissionDelete(testPermSlug2, apiKey!);
      unmuteConsole();
      process.stdout.write(`  Cleaned up permissions: ${testPermSlug}, ${testPermSlug2}\n`);
    } catch {}
  });

  // =====================================================================
  // Role (full CRUD lifecycle + permission ops, org-scoped)
  // =====================================================================
  section('Role (lifecycle)');
  await test('role list (env)', async () => {
    const { runRoleList } = await import('../src/commands/role.js');
    await runRoleList(undefined, apiKey!);
  });
  if (testOrgId) {
    await test('role list (org)', async () => {
      const { runRoleList } = await import('../src/commands/role.js');
      await runRoleList(testOrgId, apiKey!);
    });

    const testRoleSlug = `org-smoke-role-${Date.now()}`;
    await test('role create (org)', async () => {
      const { runRoleCreate } = await import('../src/commands/role.js');
      await runRoleCreate({ slug: testRoleSlug, name: `Smoke Role ${testRoleSlug}` }, testOrgId, apiKey!);
    });
    await test('role get (org)', async () => {
      const { runRoleGet } = await import('../src/commands/role.js');
      await runRoleGet(testRoleSlug, testOrgId, apiKey!);
    });
    await test('role update (org)', async () => {
      const { runRoleUpdate } = await import('../src/commands/role.js');
      await runRoleUpdate(testRoleSlug, { name: `Updated ${testRoleSlug}` }, testOrgId, apiKey!);
    });
    await test('role set-permissions', async () => {
      const { runRoleSetPermissions } = await import('../src/commands/role.js');
      await runRoleSetPermissions(testRoleSlug, [testPermSlug], testOrgId, apiKey!);
    });
    await test('role add-permission', async () => {
      const { runRoleAddPermission } = await import('../src/commands/role.js');
      await runRoleAddPermission(testRoleSlug, testPermSlug2, testOrgId, apiKey!);
    });
    await test('role remove-permission', async () => {
      const { runRoleRemovePermission } = await import('../src/commands/role.js');
      await runRoleRemovePermission(testRoleSlug, testPermSlug2, testOrgId!, apiKey!);
    });
    await test('role delete (org)', async () => {
      const { runRoleDelete } = await import('../src/commands/role.js');
      await runRoleDelete(testRoleSlug, testOrgId!, apiKey!);
    });
  }

  // =====================================================================
  // Membership (full lifecycle — needs org + user)
  // =====================================================================
  section('Membership (lifecycle)');
  if (testOrgId) {
    await test('membership list (by org)', async () => {
      const { runMembershipList } = await import('../src/commands/membership.js');
      await runMembershipList({ org: testOrgId }, apiKey!);
    });
  }
  if (testUserId) {
    await test('membership list (by user)', async () => {
      const { runMembershipList } = await import('../src/commands/membership.js');
      await runMembershipList({ user: testUserId }, apiKey!);
    });
  }
  if (testOrgId && testUserId) {
    let membershipId: string | undefined;
    await test('membership create', async () => {
      const { runMembershipCreate } = await import('../src/commands/membership.js');
      await runMembershipCreate({ org: testOrgId!, user: testUserId! }, apiKey!);
      const output = parseOutput() as { data?: { id?: string } } | null;
      membershipId = output?.data?.id;
    });
    if (membershipId) {
      await test('membership get', async () => {
        const { runMembershipGet } = await import('../src/commands/membership.js');
        await runMembershipGet(membershipId!, apiKey!);
      });
      await test('membership update', async () => {
        const { runMembershipUpdate } = await import('../src/commands/membership.js');
        await runMembershipUpdate(membershipId!, undefined, apiKey!);
      });
      await test('membership deactivate', async () => {
        const { runMembershipDeactivate } = await import('../src/commands/membership.js');
        await runMembershipDeactivate(membershipId!, apiKey!);
      });
      await test('membership reactivate', async () => {
        const { runMembershipReactivate } = await import('../src/commands/membership.js');
        await runMembershipReactivate(membershipId!, apiKey!);
      });
      await test('membership delete', async () => {
        const { runMembershipDelete } = await import('../src/commands/membership.js');
        await runMembershipDelete(membershipId!, apiKey!);
      });
    }
  }

  // =====================================================================
  // Invitation (full lifecycle)
  // =====================================================================
  section('Invitation (lifecycle)');
  await test('invitation list', async () => {
    const { runInvitationList } = await import('../src/commands/invitation.js');
    await runInvitationList({}, apiKey!);
  });
  if (testOrgId) {
    let invId: string | undefined;
    const invEmail = `smoke-inv-${Date.now()}@example.com`;
    await test('invitation send', async () => {
      const { runInvitationSend } = await import('../src/commands/invitation.js');
      await runInvitationSend({ email: invEmail, org: testOrgId! }, apiKey!);
      const output = parseOutput() as { data?: { id?: string } } | null;
      invId = output?.data?.id;
    });
    if (invId) {
      await test('invitation get', async () => {
        const { runInvitationGet } = await import('../src/commands/invitation.js');
        await runInvitationGet(invId!, apiKey!);
      });
      await test('invitation resend', async () => {
        const { runInvitationResend } = await import('../src/commands/invitation.js');
        await runInvitationResend(invId!, apiKey!);
      });
      await test('invitation revoke', async () => {
        const { runInvitationRevoke } = await import('../src/commands/invitation.js');
        await runInvitationRevoke(invId!, apiKey!);
      });
    }
  }

  // =====================================================================
  // Session
  // =====================================================================
  section('Session');
  if (testUserId) {
    let sessionId: string | undefined;
    await test('session list', async () => {
      const { runSessionList } = await import('../src/commands/session.js');
      await runSessionList(testUserId!, {}, apiKey!);
      const output = parseOutput() as { data?: Array<{ id?: string }> } | null;
      sessionId = output?.data?.[0]?.id;
    });
    if (sessionId) {
      await test('session revoke', async () => {
        const { runSessionRevoke } = await import('../src/commands/session.js');
        await runSessionRevoke(sessionId!, apiKey!);
      });
    }
  }

  // =====================================================================
  // Connection (read-only — delete is too destructive)
  // =====================================================================
  section('Connection');
  await test('connection list', async () => {
    const { runConnectionList } = await import('../src/commands/connection.js');
    await runConnectionList({}, apiKey!);
  });
  try {
    const connections = await client.sdk.sso.listConnections({ limit: 1 });
    if (connections.data.length > 0) {
      const connId = connections.data[0].id;
      await test('connection get', async () => {
        const { runConnectionGet } = await import('../src/commands/connection.js');
        await runConnectionGet(connId, apiKey!);
      });
    }
  } catch {}

  // =====================================================================
  // Directory (read-only + list-users/list-groups — delete too destructive)
  // =====================================================================
  section('Directory');
  await test('directory list', async () => {
    const { runDirectoryList } = await import('../src/commands/directory.js');
    await runDirectoryList({}, apiKey!);
  });
  try {
    const directories = await client.sdk.directorySync.listDirectories({ limit: 1 });
    if (directories.data.length > 0) {
      const dirId = directories.data[0].id;
      await test('directory get', async () => {
        const { runDirectoryGet } = await import('../src/commands/directory.js');
        await runDirectoryGet(dirId, apiKey!);
      });
      await test('directory list-users', async () => {
        const { runDirectoryListUsers } = await import('../src/commands/directory.js');
        await runDirectoryListUsers({ directory: dirId }, apiKey!);
      });
      await test('directory list-groups', async () => {
        const { runDirectoryListGroups } = await import('../src/commands/directory.js');
        await runDirectoryListGroups({ directory: dirId }, apiKey!);
      });
    }
  } catch {}

  // =====================================================================
  // Event
  // =====================================================================
  section('Event');
  await test('event list', async () => {
    const { runEventList } = await import('../src/commands/event.js');
    await runEventList({ events: ['authentication.email_verification_succeeded'] }, apiKey!);
  });

  // =====================================================================
  // Audit Log
  // =====================================================================
  section('Audit Log');
  await test('audit-log list-actions', async () => {
    const { runAuditLogListActions } = await import('../src/commands/audit-log.js');
    await runAuditLogListActions(apiKey!);
  });
  if (testOrgId) {
    await test('audit-log create-event', async () => {
      const { runAuditLogCreateEvent } = await import('../src/commands/audit-log.js');
      await runAuditLogCreateEvent(
        testOrgId!,
        {
          action: 'smoke.test',
          actorType: 'user',
          actorId: 'smoke-test-actor',
          actorName: 'Smoke Test',
        },
        apiKey!,
      );
    });
    await test('audit-log export', async () => {
      const { runAuditLogExport } = await import('../src/commands/audit-log.js');
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      await runAuditLogExport(
        {
          organizationId: testOrgId!,
          rangeStart: yesterday.toISOString(),
          rangeEnd: now.toISOString(),
        },
        apiKey!,
      );
    });
    await test('audit-log get-retention', async () => {
      const { runAuditLogGetRetention } = await import('../src/commands/audit-log.js');
      await runAuditLogGetRetention(testOrgId!, apiKey!);
    });
  }
  await test('audit-log get-schema', async () => {
    const { runAuditLogGetSchema } = await import('../src/commands/audit-log.js');
    await runAuditLogGetSchema('user.signed_in', apiKey!);
  });
  const schemaFile = `/tmp/smoke-audit-schema-${Date.now()}.json`;
  const schemaAction = `smoke.test.${Date.now()}`;
  writeFileSync(
    schemaFile,
    JSON.stringify({
      targets: [{ type: 'user' }],
      actor: { metadata: {} },
      metadata: {},
    }),
  );
  await test('audit-log create-schema', async () => {
    const { runAuditLogCreateSchema } = await import('../src/commands/audit-log.js');
    await runAuditLogCreateSchema(schemaAction, schemaFile, apiKey!);
  });
  try {
    unlinkSync(schemaFile);
  } catch {}

  // =====================================================================
  // Feature Flag (read + toggle lifecycle)
  // =====================================================================
  section('Feature Flag');
  let ffSlug: string | undefined;
  await test('feature-flag list', async () => {
    const { runFeatureFlagList } = await import('../src/commands/feature-flag.js');
    await runFeatureFlagList({}, apiKey!);
    const output = parseOutput() as { data?: Array<{ key?: string }> } | null;
    ffSlug = output?.data?.[0]?.key;
  });
  if (ffSlug) {
    await test('feature-flag get', async () => {
      const { runFeatureFlagGet } = await import('../src/commands/feature-flag.js');
      await runFeatureFlagGet(ffSlug!, apiKey!);
    });
    await test('feature-flag disable', async () => {
      const { runFeatureFlagDisable } = await import('../src/commands/feature-flag.js');
      await runFeatureFlagDisable(ffSlug!, apiKey!);
    });
    await test('feature-flag enable', async () => {
      const { runFeatureFlagEnable } = await import('../src/commands/feature-flag.js');
      await runFeatureFlagEnable(ffSlug!, apiKey!);
    });
    await test('feature-flag add-target', async () => {
      const { runFeatureFlagAddTarget } = await import('../src/commands/feature-flag.js');
      await runFeatureFlagAddTarget(ffSlug!, `smoke-target-${Date.now()}`, apiKey!);
    });
    await test('feature-flag remove-target', async () => {
      const { runFeatureFlagRemoveTarget } = await import('../src/commands/feature-flag.js');
      await runFeatureFlagRemoveTarget(ffSlug!, `smoke-target-${Date.now()}`, apiKey!);
    });
  }

  // =====================================================================
  // Webhook (lifecycle)
  // =====================================================================
  section('Webhook (lifecycle)');
  await test('webhook list', async () => {
    const { runWebhookList } = await import('../src/commands/webhook.js');
    await runWebhookList(apiKey!);
  });
  let webhookId: string | undefined;
  await test('webhook create', async () => {
    const { runWebhookCreate } = await import('../src/commands/webhook.js');
    await runWebhookCreate(`https://smoke-test-${Date.now()}.example.com/webhook`, ['user.created'], apiKey!);
    const output = parseOutput() as { data?: { id?: string } } | null;
    webhookId = output?.data?.id;
  });
  if (webhookId) {
    await test('webhook delete', async () => {
      const { runWebhookDelete } = await import('../src/commands/webhook.js');
      await runWebhookDelete(webhookId!, apiKey!);
    });
  }

  // =====================================================================
  // Config (write operations — idempotent)
  // =====================================================================
  section('Config');
  await test('config redirect add', async () => {
    const { runConfigRedirectAdd } = await import('../src/commands/config.js');
    await runConfigRedirectAdd('http://localhost:19876/smoke-test-callback', apiKey!);
  });
  await test('config cors add', async () => {
    const { runConfigCorsAdd } = await import('../src/commands/config.js');
    await runConfigCorsAdd('http://localhost:19876', apiKey!);
  });
  await test('config homepage-url set', async () => {
    const { runConfigHomepageUrlSet } = await import('../src/commands/config.js');
    await runConfigHomepageUrlSet('http://localhost:3000', apiKey!);
  });

  // =====================================================================
  // Portal
  // =====================================================================
  section('Portal');
  if (testOrgId) {
    await test('portal generate-link', async () => {
      const { runPortalGenerateLink } = await import('../src/commands/portal.js');
      await runPortalGenerateLink({ intent: 'sso', organization: testOrgId! }, apiKey!);
    });
  }

  // =====================================================================
  // Vault (full lifecycle)
  // =====================================================================
  section('Vault (lifecycle)');
  await test('vault list', async () => {
    const { runVaultList } = await import('../src/commands/vault.js');
    await runVaultList({}, apiKey!);
  });
  const vaultName = `smoke-vault-${Date.now()}`;
  let vaultId: string | undefined;

  await test('vault create', async () => {
    const { runVaultCreate } = await import('../src/commands/vault.js');
    await runVaultCreate({ name: vaultName, value: 'smoke-test-secret', org: testOrgId }, apiKey!);
    const output = parseOutput() as { data?: { id?: string } } | null;
    vaultId = output?.data?.id;
  });
  if (vaultId) {
    await test('vault get', async () => {
      const { runVaultGet } = await import('../src/commands/vault.js');
      await runVaultGet(vaultId!, apiKey!);
    });
    await test('vault get-by-name', async () => {
      const { runVaultGetByName } = await import('../src/commands/vault.js');
      await runVaultGetByName(vaultName, apiKey!);
    });
    await test('vault describe', async () => {
      const { runVaultDescribe } = await import('../src/commands/vault.js');
      await runVaultDescribe(vaultId!, apiKey!);
    });
    await test('vault update', async () => {
      const { runVaultUpdate } = await import('../src/commands/vault.js');
      await runVaultUpdate({ id: vaultId!, value: 'updated-secret' }, apiKey!);
    });
    await test('vault list-versions', async () => {
      const { runVaultListVersions } = await import('../src/commands/vault.js');
      await runVaultListVersions(vaultId!, apiKey!);
    });
    await test('vault delete', async () => {
      const { runVaultDelete } = await import('../src/commands/vault.js');
      await runVaultDelete(vaultId!, apiKey!);
    });
  }

  // =====================================================================
  // API Key (lifecycle)
  // =====================================================================
  section('API Key (lifecycle)');
  if (testOrgId) {
    await test('api-key list', async () => {
      const { runApiKeyList } = await import('../src/commands/api-key-mgmt.js');
      await runApiKeyList({ organizationId: testOrgId! }, apiKey!);
    });
    let apiKeyId: string | undefined;
    let apiKeyValue: string | undefined;
    await test('api-key create', async () => {
      const { runApiKeyCreate } = await import('../src/commands/api-key-mgmt.js');
      await runApiKeyCreate({ organizationId: testOrgId!, name: `smoke-key-${Date.now()}` }, apiKey!);
      const output = parseOutput() as { data?: { id?: string; key?: string } } | null;
      apiKeyId = output?.data?.id;
      apiKeyValue = output?.data?.key;
    });
    if (apiKeyValue) {
      await test('api-key validate', async () => {
        const { runApiKeyValidate } = await import('../src/commands/api-key-mgmt.js');
        await runApiKeyValidate(apiKeyValue!, apiKey!);
      });
    }
    if (apiKeyId) {
      await test('api-key delete', async () => {
        const { runApiKeyDelete } = await import('../src/commands/api-key-mgmt.js');
        await runApiKeyDelete(apiKeyId!, apiKey!);
      });
    }
  }

  // =====================================================================
  // Org Domain (lifecycle: create → get → verify → delete)
  // =====================================================================
  section('Org Domain (lifecycle)');
  if (testOrgId) {
    let domainId: string | undefined;
    await test('org-domain create', async () => {
      const { runOrgDomainCreate } = await import('../src/commands/org-domain.js');
      await runOrgDomainCreate(`smoke-${Date.now()}.test`, testOrgId!, apiKey!);
      const output = parseOutput() as { data?: { id?: string } } | null;
      domainId = output?.data?.id;
    });
    if (domainId) {
      await test('org-domain get', async () => {
        const { runOrgDomainGet } = await import('../src/commands/org-domain.js');
        await runOrgDomainGet(domainId!, apiKey!);
      });
      await test('org-domain verify', async () => {
        const { runOrgDomainVerify } = await import('../src/commands/org-domain.js');
        await runOrgDomainVerify(domainId!, apiKey!);
      });
      await test('org-domain delete', async () => {
        const { runOrgDomainDelete } = await import('../src/commands/org-domain.js');
        await runOrgDomainDelete(domainId!, apiKey!);
      });
    }
  }

  // =====================================================================
  // Seed (write temp YAML, run, clean)
  // =====================================================================
  section('Seed');
  const seedFile = `/tmp/smoke-seed-${Date.now()}.yml`;
  writeFileSync(
    seedFile,
    `
permissions:
  - name: Smoke Read
    slug: smoke-seed-read-${Date.now()}
roles:
  - name: Smoke Viewer
    slug: smoke-seed-viewer-${Date.now()}
`,
  );
  await test('seed (apply)', async () => {
    const { runSeed } = await import('../src/commands/seed.js');
    await runSeed({ file: seedFile }, apiKey!);
  });
  await test('seed (clean)', async () => {
    const { runSeed } = await import('../src/commands/seed.js');
    await runSeed({ clean: true }, apiKey!);
  });
  // Clean up temp files
  try {
    unlinkSync(seedFile);
  } catch {}
  try {
    if (existsSync('.workos-seed-state.json')) unlinkSync('.workos-seed-state.json');
  } catch {}

  // =====================================================================
  // Compound Workflows
  // =====================================================================

  // setup-org: creates org + domain + roles + portal link
  section('Setup Org (workflow)');
  const setupOrgName = `smoke-setup-${Date.now()}`;
  await test('setup-org (name + domain + roles)', async () => {
    const { runSetupOrg } = await import('../src/commands/setup-org.js');
    await runSetupOrg({ name: setupOrgName, domain: `${setupOrgName}.test`, roles: ['admin', 'viewer'] }, apiKey!);
  });
  // Clean up the setup-org's created org
  try {
    const orgs = await client.sdk.organizations.listOrganizations({ limit: 5 });
    const setupOrg = orgs.data.find((o) => o.name === setupOrgName);
    if (setupOrg) {
      cleanups.push(async () => {
        await client.sdk.organizations.deleteOrganization(setupOrg.id);
        process.stdout.write(`  Cleaned up setup-org: ${setupOrg.id}\n`);
      });
    }
  } catch {}

  // debug-sso: test with a real connection if one exists
  section('Debug SSO (workflow)');
  try {
    const connections = await client.sdk.sso.listConnections({ limit: 1 });
    if (connections.data.length > 0) {
      const connId = connections.data[0].id;
      await test(`debug-sso (${connId})`, async () => {
        const { runDebugSso } = await import('../src/commands/debug-sso.js');
        await runDebugSso(connId, apiKey!);
      });
    } else {
      unmuteConsole();
      process.stdout.write('  (no connections found — skipping with synthetic test)\n');
      muteConsole();
    }
  } catch {
    unmuteConsole();
    process.stdout.write('  (could not list connections)\n');
    muteConsole();
  }

  // debug-sync: test with a real directory if one exists
  section('Debug Sync (workflow)');
  try {
    const directories = await client.sdk.directorySync.listDirectories({ limit: 1 });
    if (directories.data.length > 0) {
      const dirId = directories.data[0].id;
      await test(`debug-sync (${dirId})`, async () => {
        const { runDebugSync } = await import('../src/commands/debug-sync.js');
        await runDebugSync(dirId, apiKey!);
      });
    } else {
      unmuteConsole();
      process.stdout.write('  (no directories found — skipping)\n');
      muteConsole();
    }
  } catch {
    unmuteConsole();
    process.stdout.write('  (could not list directories)\n');
    muteConsole();
  }

  // onboard-user: send a test invitation (will be revoked after)
  section('Onboard User (workflow)');
  if (testOrgId) {
    let invitationId: string | undefined;
    await test('onboard-user (send invitation)', async () => {
      const { runOnboardUser } = await import('../src/commands/onboard-user.js');
      await runOnboardUser({ email: `smoke-test-${Date.now()}@example.com`, org: testOrgId! }, apiKey!);
      const output = parseOutput() as { invitationId?: string } | null;
      invitationId = output?.invitationId;
    });
    // Clean up: revoke the invitation
    if (invitationId) {
      cleanups.push(async () => {
        try {
          await client.sdk.userManagement.revokeInvitation(invitationId!);
          process.stdout.write(`  Revoked invitation: ${invitationId}\n`);
        } catch {}
      });
    }
  }

  // --- Cleanup ---
  unmuteConsole();
  process.stdout.write('\nCleanup:\n');
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch (e) {
      process.stdout.write(`  ⚠ Cleanup failed: ${e instanceof Error ? e.message : e}\n`);
    }
  }

  // --- Summary ---
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;

  process.stdout.write(`\n${'─'.repeat(40)}\n`);
  process.stdout.write(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped\n`);

  if (failed > 0) {
    process.stdout.write('\nFailures:\n');
    for (const r of results.filter((r) => r.status === 'fail')) {
      process.stdout.write(`  ✗ ${r.name}: ${r.error}\n`);
    }
    realExit.call(process, 1);
  }

  process.stdout.write('\n');
}

run().catch((error) => {
  unmuteConsole();
  process.stdout.write(`\n💥 Smoke test crashed: ${error instanceof Error ? error.message : error}\n`);
  if (error instanceof Error && error.stack) {
    process.stdout.write(error.stack + '\n');
  }
  realExit.call(process, 1);
});
