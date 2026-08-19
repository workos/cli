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
    const activeEnv = getActiveEnvironment();

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
