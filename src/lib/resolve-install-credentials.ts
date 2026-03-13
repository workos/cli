/**
 * Resolve credentials for install flow.
 * Priority: existing creds (env var, --api-key, active env) -> unclaimed env provisioning -> login fallback.
 *
 * The installer needs both API credentials (for WorkOS API calls) AND gateway auth
 * (for the LLM agent). This function ensures both are available:
 * - Unclaimed env: API key + claim token (claim token proxy handles gateway)
 * - Logged-in user: API key + OAuth token (credential proxy handles gateway)
 * - Direct mode: handled separately (ANTHROPIC_API_KEY, no gateway)
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

  const { getActiveEnvironment, isUnclaimedEnvironment } = await import('./config-store.js');
  const { hasCredentials } = await import('./credentials.js');
  const activeEnv = getActiveEnvironment();

  if (activeEnv?.apiKey) {
    // Has API key — but does it have gateway auth?
    if (isUnclaimedEnvironment(activeEnv)) {
      // Unclaimed with claim token — claim token proxy will handle gateway
      return;
    }
    if (hasCredentials()) {
      // Has OAuth tokens — credential proxy will handle gateway
      return;
    }
    // Has API key but no gateway auth — need to log in
    if (!skipAuth) await authenticate();
    return;
  }

  // No existing credentials — try unclaimed env provisioning
  const { tryProvisionUnclaimedEnv } = await import('./unclaimed-env-provision.js');
  const dir = installDir ?? process.cwd();
  const provisioned = await tryProvisionUnclaimedEnv({ installDir: dir });
  if (!provisioned) {
    // Unclaimed env provisioning failed — fall back to login
    if (!skipAuth) await authenticate();
  }
}
