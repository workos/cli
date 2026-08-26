/**
 * Resolve credentials for install flow.
 * Priority: existing creds (env var, --api-key, active env) -> unclaimed env provisioning -> login fallback.
 *
 * The installer needs both API credentials (for WorkOS API calls) AND gateway auth
 * (for the LLM agent). This function ensures both are available:
 * - Unclaimed env: API key + claim token (claim token proxy handles gateway)
 * - Logged-in user: API key + OAuth token (credential proxy handles gateway)
 * - Direct mode: not handled here (resolved in agent-interface.ts via ANTHROPIC_API_KEY)
 */
import type { EnvironmentConfig } from './config-store.js';

/**
 * When several stored profiles could serve this install, ask which WorkOS
 * environment to use instead of silently taking the active one — profile
 * names like 'staging-3' say nothing about which dashboard environment they
 * target, and installs write the chosen credentials into the project.
 *
 * Never prompts for: explicit keys (handled before this runs), non-interactive
 * modes (including --json on a TTY — ui.select would throw), projects that
 * already carry their own WORKOS_API_KEY (the no-clobber path keeps the
 * project's key; prompting would convert it into an overwrite with a picked
 * profile's key), or configs with fewer than two keyed profiles. Choosing
 * persists via setActiveEnvironment so the installer and every later command
 * agree; cancel cancels the install (exit 2), matching the installer's other
 * prompts.
 */
async function maybePickInstallEnvironment(
  activeEnv: EnvironmentConfig | null,
  installDir: string,
): Promise<EnvironmentConfig | null> {
  const { isPromptAllowed } = await import('../utils/interaction-mode.js');
  const { isJsonMode } = await import('../utils/output.js');
  if (!isPromptAllowed() || isJsonMode()) return activeEnv;

  const { readProjectEnvCredentials } = await import('./project-env.js');
  if (readProjectEnvCredentials(installDir).apiKey) return activeEnv;

  const { getConfig, getActiveEnvironment, setActiveEnvironment, profileEnvironmentLabel } =
    await import('./config-store.js');
  const config = getConfig();
  if (!config) return activeEnv;
  const candidates = Object.entries(config.environments).filter(([, env]) => env.apiKey);
  if (candidates.length < 2) return activeEnv;

  const ui = (await import('../utils/ui.js')).default;
  const { ExitCode, exitWithCode } = await import('../utils/exit-codes.js');
  const chalk = (await import('chalk')).default;

  // Lead with the environment (the thing being chosen); the profile key is
  // bookkeeping and rides dim in the metadata. Labels are column-aligned —
  // padEnd runs on the PLAIN name before any color, so ANSI codes never
  // skew the columns (see the env-list alignment bug).
  const displayFor = (key: string, env: EnvironmentConfig): string => profileEnvironmentLabel(env) ?? key;
  const nameW = Math.max(...candidates.map(([key, env]) => displayFor(key, env).length));

  ui.note(`This machine knows ${candidates.length} WorkOS environments — pick the one this app should call home.`);

  const choice = await ui.select({
    message: 'Which WorkOS environment should this install use?',
    options: candidates.map(([key, env]) => {
      const display = displayFor(key, env);
      const type = env.type === 'sandbox' ? 'Sandbox' : env.type === 'unclaimed' ? 'Unclaimed' : 'Production';
      // Only show the profile key when it isn't already the display name.
      const meta = [display === key ? null : key, type].filter(Boolean).join(' · ');
      let label = `${display.padEnd(nameW)}  ${chalk.dim(meta)}`;
      if (key === config.activeEnvironment) label += ` ${chalk.green('● active')}`;
      return { value: key, label };
    }),
    initialValue: config.activeEnvironment,
  });
  if (ui.isCancel(choice)) exitWithCode(ExitCode.CANCELLED);
  if (choice !== config.activeEnvironment) setActiveEnvironment(String(choice));
  return getActiveEnvironment();
}

/**
 * The install machine's staging-credential step. Source priority: active
 * profile -> cached staging pair -> fresh staging fetch (persisted for reuse).
 *
 * The no-clobber contract for project-owned keys: when the user consented to
 * the env-file scan and the project STILL lands here, the scan found no valid
 * client ID (a complete pair short-circuits into `configuring`) -- i.e. the
 * project is key-only. No API maps a secret key back to its environment, so
 * no fallback can supply the matching client ID: adopting another
 * environment's would configure the app against two environments at once, and
 * returning a full fallback pair would silently re-point it. Refuse both by
 * throwing -- the machine routes staging failures to the manual prompt, where
 * the user supplies the matching pair. When the scan was declined the project
 * opted out of its env files being used, and the fallback pair applies.
 */
export async function resolveStagingCredentials(
  installDir: string,
  envScanConsent: boolean | undefined,
): Promise<{ clientId: string; apiKey: string }> {
  const { getActiveEnvironment, getConfig, saveConfig } = await import('./config-store.js');
  const { getAccessToken, getStagingCredentials, saveStagingCredentials } = await import('./credentials.js');

  if (envScanConsent) {
    const { readProjectEnvCredentials } = await import('./project-env.js');
    const { isValidApiKey } = await import('./credential-discovery.js');
    const projectKey = readProjectEnvCredentials(installDir).apiKey;
    if (projectKey && isValidApiKey(projectKey)) {
      throw new Error(
        'This project already has WORKOS_API_KEY but no valid WORKOS_CLIENT_ID, and the matching client ID cannot be looked up automatically',
      );
    }
  }

  const activeEnv = getActiveEnvironment();
  if (activeEnv?.clientId && activeEnv?.apiKey) {
    return { clientId: activeEnv.clientId, apiKey: activeEnv.apiKey };
  }

  const cached = getStagingCredentials();
  if (cached) return cached;

  const token = getAccessToken();
  if (!token) throw new Error('No access token available');

  const { fetchStagingCredentials } = await import('./staging-api.js');
  const staging = await fetchStagingCredentials(token);
  saveStagingCredentials(staging);

  try {
    const config = getConfig() ?? { environments: {} };
    if (!config.environments['default']) {
      config.environments['default'] = {
        name: 'default',
        type: staging.apiKey.startsWith('sk_test_') ? 'sandbox' : 'production',
        apiKey: staging.apiKey,
        clientId: staging.clientId,
      };
      if (!config.activeEnvironment) {
        config.activeEnvironment = 'default';
      }
      saveConfig(config);
    }
  } catch {
    // Don't block install if config-store write fails
  }

  return staging;
}

export async function resolveInstallCredentials(
  apiKey: string | undefined,
  installDir: string | undefined,
  skipAuth: boolean | undefined,
  authenticate: () => Promise<unknown>,
): Promise<void> {
  // Explicit API key from env var or flag — user handles gateway auth separately
  const envApiKey = process.env.WORKOS_API_KEY;
  if (envApiKey) return;
  if (apiKey) return;

  try {
    const { getActiveEnvironment, isUnclaimedEnvironment } = await import('./config-store.js');
    const { getAccessToken } = await import('./credentials.js');
    const activeEnv = await maybePickInstallEnvironment(getActiveEnvironment(), installDir ?? process.cwd());

    if (activeEnv?.apiKey) {
      // Has API key — but does it have gateway auth?
      if (isUnclaimedEnvironment(activeEnv)) {
        // Unclaimed with claim token — claim token proxy will handle gateway
        return;
      }
      if (getAccessToken()) {
        // Has a valid OAuth token — credential proxy will handle gateway.
        return;
      }
      // Has API key but no valid gateway auth — refresh or log in.
      if (!skipAuth) await authenticate();
      return;
    }

    const dir = installDir ?? process.cwd();

    // The CLI has no credentials, but the project might: provisioning writes to
    // the project's env file, so a key already sitting there means we must not
    // provision. Fall back to login instead — the project has a key, we just
    // have no gateway auth.
    const { readProjectEnvCredentials, resolveProjectEnvPath } = await import('./project-env.js');
    const projectEnv = readProjectEnvCredentials(dir);
    if (projectEnv.apiKey) {
      const { logInfo } = await import('../utils/debug.js');
      logInfo('[resolve-install-credentials] Project env already has WORKOS_API_KEY — skipping provisioning');

      // Say it out loud. This is the branch that actually fires, and without a
      // line here the login that follows looks identical to a provisioning
      // network failure — the user never learns their key was found and kept.
      const { isJsonMode } = await import('../utils/output.js');
      if (!isJsonMode()) {
        const ui = (await import('../utils/ui.js')).default;
        const envPath = projectEnv.apiKeyPath ?? resolveProjectEnvPath(dir);
        ui.log.info(`${envPath} already has WORKOS_API_KEY — keeping it.`);
        if (!skipAuth) ui.log.info('Signing you in so the AI installer can run.');
      }

      if (!skipAuth) await authenticate();
      return;
    }

    // No existing credentials — try unclaimed env provisioning
    const { tryProvisionUnclaimedEnv } = await import('./unclaimed-env-provision.js');
    const provisioned = await tryProvisionUnclaimedEnv({ installDir: dir });
    if (!provisioned) {
      // Unclaimed env provisioning failed — fall back to login
      if (!skipAuth) await authenticate();
    }
  } catch (error) {
    const { logError } = await import('../utils/debug.js');
    logError('[resolve-install-credentials] Failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}
