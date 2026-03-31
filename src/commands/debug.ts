import chalk from 'chalk';
import clack from '../utils/clack.js';
import {
  getCredentials,
  saveCredentials,
  clearCredentials,
  isTokenExpired,
  diagnoseCredentials,
  getCredentialsPath,
  setInsecureStorage,
} from '../lib/credentials.js';
import {
  getConfig,
  saveConfig,
  clearConfig,
  getConfigPath,
  setInsecureConfigStorage,
  diagnoseConfig,
} from '../lib/config-store.js';
import { isJsonMode, outputJson, exitWithError } from '../utils/output.js';
import { isNonInteractiveEnvironment } from '../utils/environment.js';

function maskSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

function determineCredentialSource(diagnostics: string[]): 'keyring' | 'file' | 'none' {
  const hasKeyring = diagnostics.some((l) => l.startsWith('keyring: found'));
  const hasFile = diagnostics.some((l) => l.includes('exists=true'));
  const isInsecure = diagnostics.some((l) => l.includes('insecureStorage=true'));

  if (isInsecure) return hasFile ? 'file' : 'none';
  if (hasKeyring) return 'keyring';
  if (hasFile) return 'file';
  return 'none';
}

// --- debug state ---

export async function runDebugState({ showSecrets }: { showSecrets: boolean }): Promise<void> {
  const creds = getCredentials();
  const config = getConfig();
  const diagnostics = diagnoseCredentials();
  const credSource = determineCredentialSource(diagnostics);
  const maybeRedact = showSecrets ? (v: string | undefined) => v : maskSecret;

  const credentialsOutput: Record<string, unknown> = { present: !!creds, source: credSource };

  if (creds) {
    const timeRemaining = creds.expiresAt - Date.now();
    const expired = isTokenExpired(creds);
    Object.assign(credentialsOutput, {
      userId: creds.userId,
      email: creds.email ?? null,
      accessToken: maybeRedact(creds.accessToken),
      refreshToken: creds.refreshToken ? 'present' : 'absent',
      expiresAt: creds.expiresAt,
      expiresIn: expired
        ? `expired ${formatTimeRemaining(-timeRemaining)} ago`
        : `in ${formatTimeRemaining(timeRemaining)}`,
      isExpired: expired,
    });
    if (creds.staging) {
      credentialsOutput.staging = {
        clientId: creds.staging.clientId,
        apiKey: maybeRedact(creds.staging.apiKey),
        fetchedAt: creds.staging.fetchedAt,
      };
    }
  }

  const configOutput: Record<string, unknown> = { present: !!config };

  if (config) {
    configOutput.activeEnvironment = config.activeEnvironment ?? null;
    configOutput.environments = Object.fromEntries(
      Object.entries(config.environments).map(([key, env]) => [
        key,
        {
          name: env.name,
          type: env.type,
          apiKey: maybeRedact(env.apiKey),
          clientId: env.clientId ?? null,
          endpoint: env.endpoint ?? null,
          ...(env.type === 'unclaimed' && { claimToken: maybeRedact(env.claimToken) }),
        },
      ]),
    );
  }

  const configDiagnostics = diagnoseConfig();
  const configSource = determineCredentialSource(configDiagnostics);
  configOutput.source = configSource;

  const result = {
    credentials: credentialsOutput,
    config: configOutput,
    storage: {
      credentialsPath: getCredentialsPath(),
      configPath: getConfigPath(),
      credentialDiagnostics: diagnostics,
      configDiagnostics,
    },
  };

  if (isJsonMode()) {
    outputJson(result);
    return;
  }

  console.log(chalk.bold('Credentials'));
  console.log(`  present: ${creds ? chalk.green('true') : chalk.yellow('false')}`);
  console.log(`  source:  ${credSource}`);
  if (creds) {
    console.log(`  userId:  ${creds.userId}`);
    console.log(`  email:   ${creds.email ?? chalk.dim('none')}`);
    console.log(`  token:   ${maybeRedact(creds.accessToken)}`);
    console.log(`  refresh: ${creds.refreshToken ? 'present' : 'absent'}`);
    const expired = isTokenExpired(creds);
    const timeRemaining = creds.expiresAt - Date.now();
    console.log(
      `  expires: ${expired ? chalk.red(`expired ${formatTimeRemaining(-timeRemaining)} ago`) : chalk.green(`in ${formatTimeRemaining(timeRemaining)}`)}`,
    );
    if (creds.staging) {
      console.log(`  staging: clientId=${creds.staging.clientId} apiKey=${maybeRedact(creds.staging.apiKey)}`);
    }
  }

  console.log();
  console.log(chalk.bold('Config'));
  console.log(`  present: ${config ? chalk.green('true') : chalk.yellow('false')}`);
  console.log(`  source:  ${configSource}`);
  if (config) {
    console.log(`  active:  ${config.activeEnvironment ?? chalk.dim('none')}`);
    for (const [key, env] of Object.entries(config.environments)) {
      console.log(`  env[${key}]: type=${env.type} apiKey=${maybeRedact(env.apiKey)}`);
      if (env.type === 'unclaimed') console.log(`    claimToken=${maybeRedact(env.claimToken)}`);
    }
  }

  console.log();
  console.log(chalk.bold('Storage — Credentials'));
  console.log(`  path: ${getCredentialsPath()}`);
  for (const line of diagnostics) {
    console.log(`  ${chalk.dim(line)}`);
  }

  console.log();
  console.log(chalk.bold('Storage — Config'));
  console.log(`  path: ${getConfigPath()}`);
  for (const line of configDiagnostics) {
    console.log(`  ${chalk.dim(line)}`);
  }
}

// --- debug reset ---

export async function runDebugReset({
  force,
  credentialsOnly,
  configOnly,
}: {
  force: boolean;
  credentialsOnly: boolean;
  configOnly: boolean;
}): Promise<void> {
  // Both flags = clear both (same as neither)
  const clearCreds = !configOnly || credentialsOnly;
  const clearConf = !credentialsOnly || configOnly;

  const targets = [clearCreds && 'credentials', clearConf && 'config'].filter(Boolean).join(' and ');

  if (!force) {
    if (isNonInteractiveEnvironment()) {
      exitWithError({
        code: 'non_interactive_reset',
        message: 'Use --force to reset in non-interactive mode',
      });
    }

    const confirmed = await clack.confirm({
      message: `Clear all ${targets}? This cannot be undone.`,
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      if (isJsonMode()) {
        outputJson({ cleared: false, cancelled: true });
      } else {
        clack.log.info('Reset cancelled');
      }
      return;
    }
  }

  if (clearCreds) clearCredentials();
  if (clearConf) clearConfig();

  if (isJsonMode()) {
    outputJson({ cleared: true, credentials: clearCreds, config: clearConf });
  } else {
    clack.log.success(`Cleared ${targets}`);
  }
}

// --- debug simulate ---

export async function runDebugSimulate({
  expiredToken,
  noKeyring,
  unclaimed,
  noAuth,
}: {
  expiredToken: boolean;
  noKeyring: boolean;
  unclaimed: boolean;
  noAuth: boolean;
}): Promise<void> {
  // Validate: at least one flag
  if (!expiredToken && !noKeyring && !unclaimed && !noAuth) {
    exitWithError({
      code: 'no_simulation_flags',
      message: 'Specify at least one simulation flag: --expired-token, --no-keyring, --unclaimed, --no-auth',
    });
  }

  // Validate: contradictory
  if (expiredToken && noAuth) {
    exitWithError({
      code: 'contradictory_flags',
      message: "Cannot combine --expired-token and --no-auth (can't expire a cleared token)",
    });
  }

  const actions: string[] = [];

  // Apply in order: storage tier first, then credential mutations, then config mutations

  if (noKeyring) {
    // Migrate current state to file storage
    const creds = getCredentials();
    const config = getConfig();

    setInsecureStorage(true);
    setInsecureConfigStorage(true);

    if (creds) saveCredentials(creds);
    if (config) saveConfig(config);

    actions.push('Forced file-only storage (keyring bypassed)');
  }

  if (expiredToken) {
    const creds = getCredentials();
    if (!creds) {
      exitWithError({
        code: 'no_credentials',
        message: 'Cannot simulate expired token — no credentials found. Log in first.',
      });
    }
    saveCredentials({ ...creds, expiresAt: Date.now() - 60_000 });
    actions.push('Set token expiresAt to 1 minute ago');
  }

  if (noAuth) {
    clearCredentials();
    actions.push('Cleared credentials (config preserved)');
  }

  if (unclaimed) {
    const config = getConfig() ?? { environments: {} };
    const envName = 'simulated-unclaimed';
    config.environments[envName] = {
      name: envName,
      type: 'unclaimed',
      apiKey: 'sk_test_simulated_unclaimed_000000000000',
      clientId: 'client_simulated',
      claimToken: 'claim_simulated_token_000000000000',
    };
    config.activeEnvironment = envName;
    saveConfig(config);
    actions.push(`Created unclaimed environment "${envName}" and set as active`);
  }

  if (isJsonMode()) {
    outputJson({ simulated: true, actions });
  } else {
    for (const action of actions) {
      clack.log.success(action);
    }
  }
}

// --- debug env ---

interface EnvVarInfo {
  name: string;
  value: string | undefined;
  effect: string;
}

const ENV_VAR_CATALOG: { name: string; effect: string }[] = [
  { name: 'WORKOS_API_KEY', effect: 'Bypasses credential resolution — used directly for API calls' },
  { name: 'WORKOS_FORCE_TTY', effect: 'Forces human (non-JSON) output mode, even when piped' },
  { name: 'WORKOS_NO_PROMPT', effect: 'Forces non-interactive/JSON mode' },
  { name: 'WORKOS_TELEMETRY', effect: 'Set to "false" to disable telemetry' },
  { name: 'WORKOS_API_URL', effect: 'Overrides API base URL (default: https://api.workos.com)' },
  { name: 'WORKOS_DASHBOARD_URL', effect: 'Overrides dashboard URL (default: https://dashboard.workos.com)' },
  { name: 'WORKOS_AUTHKIT_DOMAIN', effect: 'Overrides AuthKit domain from settings' },
  { name: 'WORKOS_LLM_GATEWAY_URL', effect: 'Overrides LLM gateway URL from settings' },
  { name: 'INSTALLER_DEV', effect: 'Enables dev mode — loads .env.local at startup' },
  { name: 'INSTALLER_DISABLE_PROXY', effect: 'Disables the credential proxy for gateway auth' },
];

export async function runDebugEnv(): Promise<void> {
  const vars: EnvVarInfo[] = ENV_VAR_CATALOG.map(({ name, effect }) => ({
    name,
    value: process.env[name],
    effect,
  }));

  const setVars = vars.filter((v) => v.value !== undefined);
  const unsetVars = vars.filter((v) => v.value === undefined);

  if (isJsonMode()) {
    outputJson({
      variables: Object.fromEntries(vars.map((v) => [v.name, { value: v.value ?? null, effect: v.effect }])),
      set: setVars.map((v) => v.name),
      unset: unsetVars.map((v) => v.name),
    });
    return;
  }

  if (setVars.length > 0) {
    console.log(chalk.bold('Set'));
    for (const v of setVars) {
      console.log(`  ${chalk.green(v.name)}=${v.value}`);
      console.log(`    ${chalk.dim(v.effect)}`);
    }
    console.log();
  }

  console.log(chalk.bold(`Unset${setVars.length > 0 ? '' : ' (none active)'}`));
  for (const v of unsetVars) {
    console.log(`  ${chalk.dim(v.name)} — ${chalk.dim(v.effect)}`);
  }
}

// --- debug token ---

export async function runDebugToken(): Promise<void> {
  const creds = getCredentials();

  if (!creds) {
    if (isJsonMode()) {
      outputJson({ present: false });
    } else {
      console.log(chalk.yellow('No credentials found'));
    }
    return;
  }

  const claims = parseJwt(creds.accessToken);
  const expired = isTokenExpired(creds);
  const timeRemaining = creds.expiresAt - Date.now();

  if (isJsonMode()) {
    outputJson({
      present: true,
      format: claims ? 'jwt' : 'opaque',
      expired,
      expiresAt: creds.expiresAt,
      expiresIn: expired
        ? `expired ${formatTimeRemaining(-timeRemaining)} ago`
        : `in ${formatTimeRemaining(timeRemaining)}`,
      claims: claims ?? null,
      refreshToken: { present: !!creds.refreshToken },
    });
    return;
  }

  if (claims) {
    console.log(chalk.bold('JWT Token'));
    console.log(
      `  expires: ${expired ? chalk.red(`expired ${formatTimeRemaining(-timeRemaining)} ago`) : chalk.green(`in ${formatTimeRemaining(timeRemaining)}`)}`,
    );
    console.log();
    console.log(chalk.bold('Claims'));
    for (const [key, value] of Object.entries(claims)) {
      if (key === 'exp' || key === 'iat' || key === 'nbf') {
        const date = new Date((value as number) * 1000).toISOString();
        console.log(`  ${key}: ${value} (${date})`);
      } else {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      }
    }
  } else {
    console.log(chalk.bold('Opaque Token'));
    console.log(chalk.dim('  Token is not a JWT — cannot decode claims'));
    console.log(
      `  expires: ${expired ? chalk.red(`expired ${formatTimeRemaining(-timeRemaining)} ago`) : chalk.green(`in ${formatTimeRemaining(timeRemaining)}`)}`,
    );
  }

  console.log();
  console.log(`  refresh token: ${creds.refreshToken ? chalk.green('present') : chalk.yellow('absent')}`);
}
