/**
 * verify-login: prove the AuthKit login loop end-to-end against the active
 * environment, headlessly (no browser, no email/OTP retrieval).
 *
 * The command creates a throwaway user, authenticates it with the password
 * grant, asserts access + refresh tokens come back, and deletes the user in a
 * `finally` block so cleanup always runs. It refuses to touch a production
 * environment (unconditional, no override) because it mutates real users.
 */

import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { outputJson, isJsonMode, exitWithError } from '../utils/output.js';
import { exitWithCode, ExitCode } from '../utils/exit-codes.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

// Widen this union (e.g. 'magic-auth') only alongside the code path that verifies it.
export type VerifyLoginMethod = 'password';

export interface VerifyLoginOptions {
  /** Already resolved by bin.ts via resolveApiKey (exits 4 if none). */
  apiKey: string;
  /** --client-id ?? activeEnv.clientId. */
  clientId?: string;
  /** resolveApiBaseUrl(). */
  baseUrl?: string;
  /** activeEnv.type — drives the production refusal. */
  envType?: 'production' | 'sandbox' | 'unclaimed' | null;
  /** activeEnv.name — display only. */
  envName?: string;
  /** Authentication method to verify (default 'password'). */
  method?: VerifyLoginMethod;
}

interface Check {
  name: 'create_user' | 'authenticate' | 'tokens';
  passed: boolean;
  detail: string;
}

interface VerifyLoginResult {
  success: boolean;
  method: VerifyLoginMethod;
  environment: string | null;
  checks: Check[];
  userId: string | null;
  userCleanedUp: boolean;
  orphanedUserId: string | null;
}

/**
 * A clearly-labeled, non-routable throwaway email so the user is obvious in the
 * dashboard if cleanup ever fails.
 */
function generateEmail(): string {
  return `verify-login+${crypto.randomUUID()}@example.workos.dev`;
}

/**
 * A strong random password (>= 24 chars) mixing character classes so it
 * satisfies the API password policy regardless of the specific rules. The
 * fixed `Aa1!` suffix guarantees upper/lower/digit/symbol coverage on top of
 * the random base64url body.
 */
function generatePassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const body = Buffer.from(bytes).toString('base64url');
  return `${body}Aa1!`;
}

/**
 * Translate an authenticate error into a human-readable check detail. When the
 * failure looks like "password authentication not enabled" (a config gap, not a
 * broken login) surface an actionable message instead of a bare error so agents
 * do not misread it as "login is broken".
 *
 * NOTE: the exact code/message returned when password auth is disabled is
 * UNCONFIRMED against a live environment; the heuristic below is best-effort and
 * falls back to the raw error message.
 */
function describeAuthError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/password/i.test(message) && /(not enabled|disabled|not available|unavailable)/i.test(message)) {
    return (
      'Password authentication is not enabled for this environment. Enable it in the WorkOS ' +
      'Dashboard (User Management → Authentication).'
    );
  }
  return message;
}

function printHuman(result: VerifyLoginResult): void {
  for (const check of result.checks) {
    const mark = check.passed ? chalk.green('✓') : chalk.red('✗');
    console.log(`${mark} ${check.detail}`);
  }

  if (result.userId) {
    if (result.userCleanedUp) {
      console.log(`${chalk.green('✓')} Cleaned up test user`);
    } else {
      console.log(
        chalk.yellow(`⚠ Could not delete test user ${result.orphanedUserId} — delete it manually in the dashboard.`),
      );
    }
  }

  const envLabel = result.environment ?? 'the active environment';
  if (result.success) {
    console.log(chalk.green(`Login verification passed for ${envLabel}.`));
  } else {
    console.log(chalk.red(`Login verification FAILED for ${envLabel}.`));
  }
}

export async function runVerifyLogin(options: VerifyLoginOptions): Promise<void> {
  const method: VerifyLoginMethod = options.method ?? 'password';
  const environment = options.envName ?? null;

  // 1. Production refusal — before any SDK call. verify-login mutates real
  // users, so it must never touch production. Refuse on either the stored env
  // type OR a production-format key (belt-and-suspenders for keys passed via
  // --api-key / WORKOS_API_KEY with no matching stored env).
  if (options.envType === 'production' || options.apiKey.startsWith('sk_live_')) {
    exitWithError({
      code: 'production_env_refused',
      message:
        'verify-login creates and deletes real users and will not run against a production ' +
        'environment. Switch to a staging/sandbox environment first.',
    });
  }

  // 2. clientId check — required for the password grant.
  const clientId = options.clientId;
  if (!clientId) {
    exitWithError({
      code: 'missing_client_id',
      message:
        `No client ID for the active environment. Pass --client-id, or configure one via ` +
        `\`${formatWorkOSCommand('profile add --client-id <id>')}\`.`,
    });
  }

  // 3. Construct the client.
  const { sdk } = createWorkOSClient(options.apiKey, options.baseUrl);

  // 4. Generate throwaway credentials.
  const email = generateEmail();
  const password = generatePassword();

  // 5. Run the round-trip. Cleanup runs in `finally` so no orphaned user
  // remains on the happy path or on an authentication failure.
  const checks: Check[] = [];
  let userId: string | null = null;
  let userCleanedUp = true;
  let orphanedUserId: string | null = null;

  try {
    const user = await sdk.userManagement.createUser({ email, password, emailVerified: true });
    userId = user.id;
    checks.push({ name: 'create_user', passed: true, detail: `Created test user ${user.id}` });

    const auth = await sdk.userManagement.authenticateWithPassword({ clientId, email, password });
    checks.push({ name: 'authenticate', passed: true, detail: 'password grant succeeded' });

    const hasTokens = Boolean(auth.accessToken && auth.refreshToken);
    checks.push({
      name: 'tokens',
      passed: hasTokens,
      detail: hasTokens ? 'access + refresh tokens present' : 'tokens missing from response',
    });
  } catch (err) {
    const failedStep: Check['name'] = userId ? 'authenticate' : 'create_user';
    checks.push({ name: failedStep, passed: false, detail: describeAuthError(err) });
  } finally {
    if (userId) {
      try {
        await sdk.userManagement.deleteUser(userId);
      } catch {
        userCleanedUp = false;
        orphanedUserId = userId;
      }
    }
  }

  const success = checks.length > 0 && checks.every((c) => c.passed);

  const result: VerifyLoginResult = {
    success,
    method,
    environment,
    checks,
    userId,
    userCleanedUp,
    orphanedUserId,
  };

  if (isJsonMode()) {
    outputJson(result);
  } else {
    printHuman(result);
  }

  // Exit follows the login verdict, not cleanup: a leaked user is surfaced
  // machine-readably but does not fail the verification. No error arg here — the
  // verdict was already emitted, so a second envelope would confuse parsers.
  if (!success) {
    exitWithCode(ExitCode.GENERAL_ERROR);
  }
}
