import { createActor, fromPromise } from 'xstate';
import open from 'open';
import { installerMachine } from './installer-core.js';
import { createInstallerEventEmitter } from './events.js';
import type { CompletionData, InstallerEventEmitter, SetupItemId, SetupItemStatus } from './events.js';
import { buildCompletionData, applicationSetupNextSteps } from './completion-data.js';
import {
  readNextjsApplicationSetup,
  buildApplicationSetup,
  configureAuthkitApplication,
  type AuthkitApplicationSetup,
} from './authkit-application-setup.js';
import { validateInstallation } from './validation/index.js';
import { resolveDevCommand } from './dev-command.js';
import { getConfig as getInstallerSettings } from './settings.js';
import { CLIAdapter } from './adapters/cli-adapter.js';
import { selectInstallerAdapter, type InstallerAdapterKind } from './adapters/select-adapter.js';
import type { InstallerAdapter } from './adapters/types.js';
import type { InstallerOptions } from '../utils/types.js';
import { getInteractionMode, isAgentMode, isCiMode } from '../utils/interaction-mode.js';
import { getOutputMode, isJsonMode, resolveEffectiveOutputMode, setOutputMode } from '../utils/output.js';
import type {
  InstallerMachineContext,
  CredentialSource,
  DetectionOutput,
  GitCheckOutput,
  AgentOutput,
  BranchCheckOutput,
  WorkspaceCheckOutput,
} from './installer-core.types.js';
import { isScaffoldableEmptyDir, resolvePackageManager, runCreateNextApp } from './scaffold/index.js';
import type { Integration } from './constants.js';
import { readProjectEnvCredentials } from './project-env.js';
import type { ProjectEnvCredentials } from './project-env.js';
import { enableDebugLogs, initLogFile, logInfo, logError } from '../utils/debug.js';

import { getAccessToken, saveCredentials } from './credentials.js';
import { getActiveEnvironment, isUnclaimedEnvironment } from './config-store.js';
import { checkForEnvFiles, discoverCredentials } from './credential-discovery.js';
import { requestDeviceCode, pollForToken } from './device-auth.js';
import { getCliAuthClientId, getAuthkitDomain } from './settings.js';
import { getTelemetryUrl } from '../utils/urls.js';
import { analytics } from '../utils/analytics.js';
import { getVersion } from './settings.js';
import { isInGitRepo, getUncommittedOrUntrackedFiles } from '../utils/ui-utils.js';
import {
  getCurrentBranch,
  isProtectedBranch,
  createBranch as createGitBranch,
  branchExists,
} from '../utils/git-utils.js';
import { detectChanges, stageAndCommit, pushBranch as pushGitBranch, createPullRequest } from './post-install.js';
import {
  generateCommitMessage as generateCommitMessageAi,
  generatePrDescription as generatePrDescriptionAi,
} from './ai-content.js';
import {
  assertSupportedNextJsRouter,
  getNextJsRouter,
  assertNextjsSignInRouteAvailable,
} from '../integrations/nextjs/utils.js';
import { detectPort, getClientEnvPrefix, getSignInPath, resolveRedirectUri } from './port-detection.js';
import { writeEnvLocal } from './env-writer.js';
import { getRegistry } from './registry.js';
import { observeHostFailure } from './host-probe.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

async function runIntegrationInstallerFn(integration: Integration, options: InstallerOptions): Promise<string> {
  const registry = await getRegistry();
  const mod = registry.get(integration);
  if (!mod) {
    throw new Error(`Unknown integration: ${integration}`);
  }
  return mod.run(options);
}

async function detectIntegrationFn(options: Pick<InstallerOptions, 'installDir'>): Promise<Integration | undefined> {
  const registry = await getRegistry();
  const configs = registry.detectionOrder();

  for (const config of configs) {
    // Use the detect function from INTEGRATION_CONFIG in config.ts for JS integrations,
    // or fall back to checking if the framework package is installed
    const detected = await detectSingleIntegration(config.metadata.integration, options);
    if (detected) {
      return config.metadata.integration;
    }
  }
  return undefined;
}

/**
 * Detect if a single integration matches the project.
 * Uses package.json detection for JS integrations, manifest files for others.
 */
export async function detectSingleIntegration(
  integration: string,
  options: Pick<InstallerOptions, 'installDir'>,
): Promise<boolean> {
  const { getPackageDotJson } = await import('../utils/ui-utils.js');
  const { hasPackageInstalled } = await import('../utils/package-json.js');
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');

  const registry = await getRegistry();
  const mod = registry.get(integration);
  if (!mod) return false;

  const config = mod.config;

  // For JS integrations, check package.json
  if (config.metadata.language === 'javascript') {
    // Without a package.json, no JS integration can match. Skip silently so
    // non-JS integrations (Python/Django, Ruby, Go, ...) still get a chance —
    // getPackageDotJson would otherwise call process.exit(1).
    if (!existsSync(join(options.installDir, 'package.json'))) {
      return false;
    }
    const packageJson = await getPackageDotJson(options);

    switch (integration) {
      case 'nextjs':
        return hasPackageInstalled('next', packageJson);
      case 'tanstack-start':
        return hasPackageInstalled('@tanstack/react-start', packageJson);
      case 'react-router':
        return hasPackageInstalled('react-router', packageJson);
      case 'react': {
        const hasReact = hasPackageInstalled('react', packageJson);
        const hasNext = hasPackageInstalled('next', packageJson);
        const hasReactRouter = hasPackageInstalled('react-router', packageJson);
        const hasTanstack = hasPackageInstalled('@tanstack/react-start', packageJson);
        const hasSvelteKit = hasPackageInstalled('@sveltejs/kit', packageJson);
        return hasReact && !hasNext && !hasReactRouter && !hasTanstack && !hasSvelteKit;
      }
      case 'sveltekit':
        return hasPackageInstalled('@sveltejs/kit', packageJson);
      case 'node': {
        const hasExpress = hasPackageInstalled('express', packageJson);
        const hasFrontend =
          hasPackageInstalled('next', packageJson) ||
          hasPackageInstalled('@sveltejs/kit', packageJson) ||
          hasPackageInstalled('react', packageJson) ||
          hasPackageInstalled('@tanstack/react-start', packageJson);
        return hasExpress && !hasFrontend;
      }
      case 'vanilla-js':
        return true; // Fallback
      default:
        // Unknown JS integration — try package name detection
        return hasPackageInstalled(config.detection.packageName, packageJson);
    }
  }

  // For non-JS integrations, prefer a custom detect() if provided
  // (e.g., Django matches manage.py | pyproject.toml | requirements.txt),
  // otherwise fall back to manifest file existence.
  if (config.metadata.detect) {
    return await config.metadata.detect(options);
  }
  if (config.metadata.manifestFile) {
    return existsSync(join(options.installDir, config.metadata.manifestFile));
  }

  return false;
}

/**
 * Provenance label for the credential pair `runWithCore` hands the machine.
 *
 * Only a pair the user supplied nothing toward can honestly name the project's
 * env file as its origin. That total backfill is the path a freshly provisioned
 * unclaimed environment takes — provisioning writes .env.local before the
 * machine starts — and labeling it 'cli' is what made the installer claim
 * credentials the user had never provided.
 *
 * A mixed pair keeps the caller's source instead: one flag plus one backfill is
 * not an env-file resolution, and calling it one makes the installer announce
 * `.env.local` as the origin of a value the user typed on the command line.
 */
export function resolveCredentialSource(
  options: Pick<InstallerOptions, 'apiKey' | 'clientId' | 'credentialSource'>,
  existingCreds: ProjectEnvCredentials,
): CredentialSource | undefined {
  const userSuppliedEither = Boolean(options.apiKey || options.clientId);
  const backfilledFromProjectEnv = !userSuppliedEither && Boolean(existingCreds.apiKey || existingCreds.clientId);
  return backfilledFromProjectEnv ? 'env' : options.credentialSource;
}

export async function configureInstallEnvironment(
  context: Pick<InstallerMachineContext, 'options' | 'integration' | 'credentials'> &
    Partial<Pick<InstallerMachineContext, 'emitter'>>,
): Promise<void> {
  const { options: installerOptions, integration, credentials } = context;
  if (!integration || !credentials) throw new Error('Missing integration or credentials');
  // Each item of the dashboard's AuthKit checklist reports as it goes, so the
  // full-screen installer can tick it off.
  const step = (id: SetupItemId, status: SetupItemStatus, detail?: string) =>
    context.emitter?.emit('config:step', { step: id, status, ...(detail ? { detail } : {}) });

  const registry = await getRegistry();
  const mod = registry.get(integration);
  if (!mod) return;
  const isJavascript = mod.config.metadata.language === 'javascript';

  if (integration === 'nextjs') {
    assertSupportedNextJsRouter(await getNextJsRouter(installerOptions));
    await assertNextjsSignInRouteAvailable(installerOptions.installDir);
  }

  const port = detectPort(integration, installerOptions.installDir);
  // All URL writes wait until after the agent. Select one target then, even if
  // credentials and the dashboard session refer to different environments or
  // the session changes between preparation and application setup.
  if (isJavascript) step('env-vars', 'started');

  // Non-JavaScript agents write their own env files in the project's format.
  if (!isJavascript) return;

  const redirectUri = resolveRedirectUri(integration, installerOptions, port);

  const redirectUriKey = integration === 'nextjs' ? 'NEXT_PUBLIC_WORKOS_REDIRECT_URI' : 'WORKOS_REDIRECT_URI';
  // Client bundlers expose only prefixed vars to browser code.
  const clientPrefix = mod.config.environment.requiresApiKey
    ? undefined
    : getClientEnvPrefix(installerOptions.installDir);
  try {
    writeEnvLocal(installerOptions.installDir, {
      ...(credentials.apiKey ? { WORKOS_API_KEY: credentials.apiKey } : {}),
      WORKOS_CLIENT_ID: credentials.clientId,
      [redirectUriKey]: redirectUri,
      ...(clientPrefix
        ? {
            [`${clientPrefix}WORKOS_CLIENT_ID`]: credentials.clientId,
            [`${clientPrefix}WORKOS_REDIRECT_URI`]: redirectUri,
          }
        : {}),
    });
  } catch (error) {
    step('env-vars', 'failed', error instanceof Error ? error.message : String(error));
    throw error;
  }
  step('env-vars', 'done');
}

export const NO_SIGN_IN_ROUTE_REASON = 'This framework has no fixed sign-in route to use.';

/**
 * Report the app URLs `configure` sets (the dashboard checklist's redirect,
 * initiate login, and sign-out URIs) as `app-urls:step` events.
 *
 * `configureAuthkitApplication` throws when the callback isn't registered,
 * which fails the install (and the items still running with it). When it
 * returns, the callback is registered; CORS and sign-out have their own results,
 * so pending initiate-login setup does not hide settings already saved.
 */
export async function reportAppUrlSetup(
  emitter: Pick<InstallerEventEmitter, 'emit'>,
  configure: () => Promise<AuthkitApplicationSetup>,
  { includeRedirect = true, includeCors = false }: { includeRedirect?: boolean; includeCors?: boolean } = {},
): Promise<AuthkitApplicationSetup> {
  const step = (id: SetupItemId, status: SetupItemStatus, detail?: string) =>
    emitter.emit('app-urls:step', { step: id, status, ...(detail ? { detail } : {}) });
  const ids = ['initiate-login-uri', 'sign-out-uri'] as const;
  for (const id of includeRedirect ? (['redirect-uri', ...ids] as const) : ids) step(id, 'started');
  if (includeCors) step('cors-origin', 'started');
  const setup = await configure();
  if (includeRedirect) step('redirect-uri', 'done');
  if (includeCors)
    step('cors-origin', setup.corsRegistered ? 'done' : 'skipped', setup.corsRegistered ? undefined : setup.reason);
  const settle = (id: SetupItemId) => (setup.verified ? step(id, 'done') : step(id, 'skipped', setup.reason));
  if (setup.initiateLoginUri === undefined)
    step('initiate-login-uri', 'skipped', setup.initiateLoginReason ?? setup.reason);
  else settle('initiate-login-uri');
  if (setup.signOutRegistered) step('sign-out-uri', 'done');
  else settle('sign-out-uri');
  return setup;
}

/**
 * Configure all URLs for SDKs other than Next.js after the agent, using one
 * target selected here. An unregistered callback fails the install.
 */
export async function configureOtherApplicationUrls(
  context: Pick<InstallerMachineContext, 'options' | 'integration' | 'emitter'>,
  clientId: string,
  apiKey?: string,
): Promise<AuthkitApplicationSetup | undefined> {
  const { options: installerOptions, integration } = context;
  if (!integration || integration === 'nextjs') return undefined;
  const signInPath = getSignInPath(integration);
  const clientOnly = (await getRegistry()).get(integration)?.config.environment.requiresApiKey === false;
  const redirectUri = resolveRedirectUri(integration, installerOptions);
  const setup: AuthkitApplicationSetup = {
    ...buildApplicationSetup({
      clientId,
      redirectUri,
      homepageUrl: installerOptions.homepageUrl,
      signInPath,
    }),
    corsOrigin: new URL(redirectUri).origin,
    ...(!signInPath ? { initiateLoginReason: NO_SIGN_IN_ROUTE_REASON } : {}),
  };
  // Source patterns cannot prove that a client route is mounted and starts sign-in.
  // Keep generating the route, but leave this dashboard setting for a browser check.
  if (signInPath && clientOnly) {
    delete setup.initiateLoginUri;
    setup.initiateLoginReason = `Client-side ${signInPath} requires browser verification. Confirm it starts sign-in without a click, then set the Initiate login URI in the WorkOS dashboard. The existing setting was left unchanged.`;
  }
  return reportAppUrlSetup(context.emitter, () => configureAuthkitApplication(setup, clientId, apiKey), {
    includeCors: true,
  });
}

/** Pick the installer adapter for this process's output mode and terminal. */
export function resolveAdapterKind(options: Pick<InstallerOptions, 'ci' | 'noTui'>): InstallerAdapterKind {
  return selectInstallerAdapter({
    json: isJsonMode(),
    interaction: getInteractionMode().mode,
    ci: Boolean(options.ci),
    stdinTTY: Boolean(process.stdin.isTTY),
    stdoutTTY: Boolean(process.stdout.isTTY),
    stderrTTY: Boolean(process.stderr.isTTY),
    columns: process.stdout.columns ?? 0,
    rows: process.stdout.rows ?? 0,
    noTui: Boolean(options.noTui),
    term: process.env.TERM,
  });
}

export async function runWithCore(options: InstallerOptions): Promise<void> {
  // Initialize debug/logging early so we capture all failures
  initLogFile();
  if (options.debug) {
    enableDebugLogs();
  }
  logInfo('Wizard starting with options:', {
    debug: options.debug,
    local: options.local,
    ci: options.ci,
    skipAuth: options.skipAuth,
    installDir: options.installDir,
  });

  // Configure telemetry endpoint separately from the LLM gateway proxy.
  const gatewayUrl = getTelemetryUrl();
  analytics.setGatewayUrl(gatewayUrl);

  const existingCreds = readProjectEnvCredentials(options.installDir);
  const augmentedOptions: InstallerOptions = {
    ...options,
    apiKey: options.apiKey || existingCreds.apiKey,
    clientId: options.clientId || existingCreds.clientId,
    credentialSource: resolveCredentialSource(options, existingCreds),
  };

  const emitter = createInstallerEventEmitter();
  let actor: ReturnType<typeof createActor<typeof installerMachine>> | null = null;

  const sendEvent = (event: { type: string; [key: string]: unknown }) => {
    if (actor) {
      actor.send(event as Parameters<typeof actor.send>[0]);
    }
  };

  const nonHumanMode = isAgentMode() || isCiMode();
  if (nonHumanMode && !isJsonMode()) {
    setOutputMode(resolveEffectiveOutputMode(getOutputMode(), getInteractionMode()));
  }
  // Headless (no prompts, structured output) is for MACHINE output only: JSON.
  // A prompt cannot render into a JSON stream, so any JSON run must be headless.
  // We deliberately do NOT route a human session with non-TTY stdin here:
  // headless auto-approves branch/commit/scaffold, and applying those unattended
  // to a session the user never opted into would violate the "nothing is written
  // until you confirm" contract. Those sessions keep the CLIAdapter, which now
  // fails fast with a clear `prompt_unavailable` error on the first prompt
  // (see CLIAdapter's handler-error catch) instead of hanging or auto-writing.
  // A person at a real terminal of at least 80x24 gets the full-screen
  // installer unless they pass --no-tui.
  const adapterKind = resolveAdapterKind(augmentedOptions);
  const headlessMode = adapterKind === 'headless';

  let adapter: InstallerAdapter;
  if (headlessMode) {
    const { HeadlessAdapter } = await import('./adapters/headless-adapter.js');
    adapter = new HeadlessAdapter({
      emitter,
      sendEvent,
      debug: augmentedOptions.debug,
      options: {
        apiKey: augmentedOptions.apiKey,
        clientId: augmentedOptions.clientId,
        noBranch: augmentedOptions.noBranch,
        noCommit: augmentedOptions.noCommit,
        createPr: augmentedOptions.createPr,
        noGitCheck: augmentedOptions.noGitCheck,
        ci: augmentedOptions.ci,
      },
    });
  } else if (adapterKind === 'tui') {
    // Loaded on demand so Ink and React stay off every other path.
    const { TuiAdapter } = await import('./adapters/tui-adapter.js');
    adapter = new TuiAdapter({
      emitter,
      sendEvent,
      debug: augmentedOptions.debug,
      installDir: augmentedOptions.installDir,
    });
  } else {
    adapter = new CLIAdapter({ emitter, sendEvent, debug: augmentedOptions.debug });
  }

  const machineWithActors = installerMachine.provide({
    actors: {
      checkAuthentication: fromPromise(async () => {
        // Check for active environment with credentials (covers unclaimed environments).
        const activeEnv = getActiveEnvironment();
        if (activeEnv?.apiKey) {
          return true;
        }

        const token = getAccessToken();
        if (!token) {
          // This should rarely happen since bin.ts handles auth first
          // But keep as safety net for programmatic usage
          throw new Error(`Not authenticated. Run \`${formatWorkOSCommand('auth login')}\` first.`);
        }

        return true;
      }),

      checkWorkspace: fromPromise<WorkspaceCheckOutput, { options: InstallerOptions }>(async ({ input }) => {
        const scaffoldable = await isScaffoldableEmptyDir(input.options.installDir);
        const packageManager = resolvePackageManager({
          pm: input.options.pm,
          userAgent: process.env.npm_config_user_agent,
        });
        // headlessMode is computed above; --scaffold opts in during interactive runs.
        const autoScaffold = scaffoldable && (headlessMode || !!input.options.scaffold);
        return { scaffoldable, packageManager, autoScaffold };
      }),

      runScaffold: fromPromise<void, { context: InstallerMachineContext }>(async ({ input }) => {
        const { options: installerOptions, packageManager, emitter: ctxEmitter } = input.context;
        await runCreateNextApp({
          installDir: installerOptions.installDir,
          packageManager: packageManager ?? 'npm',
          emitter: ctxEmitter,
        });
      }),

      detectIntegration: fromPromise<DetectionOutput, { options: InstallerOptions }>(async ({ input }) => {
        const integration = await detectIntegrationFn({ installDir: input.options.installDir });
        return { integration };
      }),

      checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => {
        if (!isInGitRepo()) {
          return { isClean: true, files: [] };
        }
        const files = getUncommittedOrUntrackedFiles();
        return { isClean: files.length === 0, files };
      }),

      configureEnvironment: fromPromise<void, { context: InstallerMachineContext }>(({ input }) =>
        configureInstallEnvironment(input.context),
      ),

      runAgent: fromPromise<AgentOutput, { context: InstallerMachineContext }>(async ({ input }) => {
        const { context } = input;
        const { options: installerOptions, integration, credentials } = context;

        if (!integration) {
          return { success: false, error: new Error('No integration specified') };
        }

        try {
          const agentOptions: InstallerOptions = {
            ...installerOptions,
            ...(integration === 'nextjs' ? { router: 'app' as const } : {}),
            apiKey: credentials?.apiKey,
            clientId: credentials?.clientId,
            credentialSource: context.credentialSource,
            emitter: context.emitter,
          };
          const summary = await runIntegrationInstallerFn(integration, agentOptions);
          let applicationSetup;
          if (integration === 'nextjs') {
            applicationSetup = await readNextjsApplicationSetup(
              installerOptions.installDir,
              installerOptions.homepageUrl,
            );
            const expectedRedirectUri = resolveRedirectUri(integration, installerOptions);
            if (applicationSetup.redirectUri !== expectedRedirectUri) {
              throw new Error(
                'The app callback URL changed during installation. Confirm it before configuring WorkOS.',
              );
            }
            // Even --no-validate must not point the dashboard at a missing route.
            const validation = await validateInstallation(integration, installerOptions.installDir, {
              runBuild: false,
            });
            if (!validation.passed) {
              throw new Error(
                `Application setup is incomplete:\n${validation.issues
                  .filter((issue) => issue.severity === 'error')
                  .map((issue) => `${issue.message}. ${issue.hint ?? ''}`)
                  .join('\n')}`,
              );
            }
            const setup = applicationSetup;
            applicationSetup = await reportAppUrlSetup(context.emitter, () =>
              configureAuthkitApplication(setup, credentials?.clientId ?? '', credentials?.apiKey),
            );
          } else if (credentials?.clientId) {
            applicationSetup = await configureOtherApplicationUrls(context, credentials.clientId, credentials.apiKey);
          }
          return {
            success: true,
            applicationSetup,
            summary:
              integration === 'nextjs' && applicationSetup
                ? ['App code installed.', ...applicationSetupNextSteps(applicationSetup)].join('\n')
                : summary || `Successfully installed WorkOS AuthKit for ${integration}!`,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      }),

      buildCompletion: fromPromise<CompletionData | undefined, { context: InstallerMachineContext }>(
        async ({ input }) => {
          const { integration, changedFiles, options: installerOptions, credentials, applicationSetup } = input.context;
          if (!integration) return undefined;
          try {
            const registry = await getRegistry();
            const mod = registry.get(integration);
            const cfg = mod?.config;
            const settings = getInstallerSettings();
            // Read the config now, at the end of the install, not from a value
            // captured earlier: the environment can be claimed mid-install (the
            // browser claim CTA), and a claimed environment must not be told to
            // claim itself. Exact credential match is required — a leftover
            // unclaimed profile can sit active while this install used the
            // project's own keys, and pointing that user at `claim` would name
            // an environment their app never touched.
            const activeEnv = getActiveEnvironment();
            const usedUnclaimedEnv = Boolean(
              activeEnv &&
              isUnclaimedEnvironment(activeEnv) &&
              credentials &&
              activeEnv.apiKey === credentials.apiKey &&
              activeEnv.clientId === credentials.clientId,
            );
            return await buildCompletionData(
              { integration, changedFiles, installDir: installerOptions.installDir },
              {
                resolveDevCommand,
                detectPort,
                docsUrl: cfg?.metadata.docsUrl ?? settings.documentation.workosDocsUrl,
                dashboardUrl: settings.documentation.dashboardUrl,
                frameworkNextSteps: cfg?.ui.getOutroNextSteps?.({}) ?? [],
                signInSnippet: cfg?.ui.getSignInSnippet?.({}),
                claimCommand: usedUnclaimedEnv ? formatWorkOSCommand('profile claim') : undefined,
                applicationSetup,
              },
            );
          } catch {
            // Degrade to the static fallback box rather than blocking completion.
            return undefined;
          }
        },
      ),

      // Credential discovery actors
      detectEnvFiles: fromPromise(async ({ input }) => {
        return checkForEnvFiles(input.installDir);
      }),

      scanEnvFiles: fromPromise(async ({ input }) => {
        return discoverCredentials(input.installDir);
      }),

      checkStoredAuth: fromPromise(async () => {
        const activeEnv = getActiveEnvironment();
        if (activeEnv?.apiKey && isUnclaimedEnvironment(activeEnv)) {
          return true;
        }

        const token = getAccessToken();
        return token !== null;
      }),

      runDeviceAuth: fromPromise(async ({ input }) => {
        const clientId = getCliAuthClientId();
        const authkitDomain = getAuthkitDomain();

        const deviceAuth = await requestDeviceCode({
          clientId,
          authkitDomain,
        });

        // Emit device started event with verification info
        input.emitter.emit('device:started', {
          verificationUri: deviceAuth.verification_uri,
          verificationUriComplete: deviceAuth.verification_uri_complete,
          userCode: deviceAuth.user_code,
        });

        // Open browser
        try {
          const { default: openFn } = await import('open');
          await openFn(deviceAuth.verification_uri_complete, { wait: false });
        } catch (error) {
          observeHostFailure('browser-launch', error, {
            operation: 'open',
            target: deviceAuth.verification_uri_complete,
            label: 'installer device auth browser',
          });
          // User can open manually
        }

        const result = await pollForToken(deviceAuth.device_code, {
          clientId,
          authkitDomain,
          interval: deviceAuth.interval,
          onPoll: () => input.emitter.emit('device:polling', {}),
        });

        // Save the auth token
        saveCredentials({
          accessToken: result.accessToken,
          expiresAt: result.expiresAt,
          userId: result.userId,
          email: result.email,
          refreshToken: result.refreshToken,
        });

        return { result, deviceAuth };
      }),

      fetchStagingCredentials: fromPromise(async ({ input }) => {
        const { resolveStagingCredentials } = await import('./resolve-install-credentials.js');
        return resolveStagingCredentials(input.installDir, input.envScanConsent);
      }),

      // Branch check actors
      checkBranch: fromPromise<BranchCheckOutput, void>(async () => {
        const branch = getCurrentBranch();
        if (!branch) {
          return { branch: null, isProtected: false };
        }
        return {
          branch,
          isProtected: isProtectedBranch(branch),
        };
      }),

      createBranch: fromPromise<{ branch: string }, { name: string; fallbackName: string }>(async ({ input }) => {
        const { name, fallbackName } = input;
        const targetBranch = branchExists(name) ? fallbackName : name;
        createGitBranch(targetBranch);
        return { branch: targetBranch };
      }),

      // Post-install actors
      detectChanges: fromPromise<{ hasChanges: boolean; files: string[] }, void>(async () => {
        return detectChanges();
      }),

      generateCommitMessage: fromPromise<string, { integration: string; files: string[]; direct?: boolean }>(
        async ({ input }) => {
          return generateCommitMessageAi(input.integration, input.files, { direct: input.direct });
        },
      ),

      commitChanges: fromPromise<void, { message: string; cwd: string }>(async ({ input }) => {
        stageAndCommit(input.message, input.cwd);
      }),

      generatePrDescription: fromPromise<
        string,
        { integration: string; files: string[]; commitMessage: string; direct?: boolean }
      >(async ({ input }) => {
        return generatePrDescriptionAi(input.integration, input.files, input.commitMessage, { direct: input.direct });
      }),

      pushBranch: fromPromise<void, { cwd: string }>(async ({ input }) => {
        pushGitBranch(input.cwd);
      }),

      createPr: fromPromise<string, { title: string; body: string; cwd: string }>(async ({ input }) => {
        return createPullRequest(input.title, input.body, input.cwd);
      }),
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let inspector: { inspect: any } | undefined;
  if (augmentedOptions.inspect) {
    const originalLog = console.log;
    let inspectUrl: string | undefined;

    console.log = (...args: unknown[]) => {
      const msg = args.join(' ');
      if (typeof msg === 'string' && msg.startsWith('https://stately.ai/inspect/')) {
        inspectUrl = msg;
        console.log = originalLog;
        console.log(`Opening XState inspector: ${inspectUrl}`);
        void open(inspectUrl).catch((error: unknown) => {
          observeHostFailure('browser-launch', error, {
            operation: 'open',
            target: inspectUrl,
            label: 'XState inspector browser',
          });
        });
      } else {
        originalLog.apply(console, args);
      }
    };

    // Dynamic import - @statelyai/inspect is a devDependency
    const { createSkyInspector } = await import('@statelyai/inspect');
    inspector = createSkyInspector();
    setTimeout(() => {
      console.log = originalLog;
    }, 5000).unref();
  }

  actor = createActor(machineWithActors, {
    input: { emitter, options: augmentedOptions },
    inspect: inspector?.inspect,
  });

  await adapter.start();

  // Environment pick lives AFTER the brand mark (adapter.start) and BEFORE the
  // machine starts (branch prompt, detection, …), so the flow reads: banner →
  // choose environment → install steps. Running pre-machine also means the
  // machine's own auth check sees the PICKED profile — switching to a profile
  // that still needs a login is handled by the in-flow device auth. Explicit
  // credentials (flag/env var) and headless runs skip it; the helper itself
  // guards JSON mode, project-owned keys, and single-profile configs.
  if (!headlessMode && !augmentedOptions.apiKey && !process.env.WORKOS_API_KEY) {
    const { maybePickInstallEnvironment } = await import('./resolve-install-credentials.js');
    try {
      await maybePickInstallEnvironment(getActiveEnvironment(), augmentedOptions.installDir);
    } catch (error) {
      // Cancelling the picker ends the run before the try/finally below, so
      // release the adapter here (the full-screen one owns the terminal).
      await adapter.stop();
      throw error;
    }
  }

  analytics.configureAuthFromAvailableSources();
  const mode = adapterKind;
  analytics.sessionStart(mode, getVersion());

  let installerStatus: 'success' | 'error' | 'cancelled' = 'success';

  // Handle ctrl+c by sending CANCEL to state machine for graceful shutdown
  const handleSigint = () => {
    installerStatus = 'cancelled';
    actor?.send({ type: 'CANCEL' });
  };
  process.on('SIGINT', handleSigint);

  try {
    await new Promise<void>((resolve, reject) => {
      actor!.subscribe({
        complete: () => {
          const snapshot = actor!.getSnapshot();
          if (snapshot.value === 'error') {
            const err = snapshot.context.error;
            installerStatus = 'error';
            reject(err ?? new Error('Wizard failed'));
          } else if (snapshot.value === 'cancelled') {
            installerStatus = 'cancelled';
            resolve();
          } else {
            resolve();
          }
        },
        error: (err) => {
          installerStatus = 'error';
          reject(err);
        },
      });

      actor!.start();
      actor!.send({ type: 'START' });
    });
  } catch (error) {
    installerStatus = 'error';
    logError('Wizard failed with error:', error instanceof Error ? error.stack || error.message : String(error));
    throw error;
  } finally {
    process.off('SIGINT', handleSigint);
    // Record the detected framework so session.end carries it (and the API can
    // tag install metrics by integration). Known only after detection runs, so
    // it's read from the final machine snapshot here; absent if the session
    // aborted before detection.
    const finalContext = actor?.getSnapshot().context;
    const detectedIntegration = finalContext?.integration;
    if (detectedIntegration) {
      analytics.setTag('installer.integration', detectedIntegration);
    }
    // Record whether the empty-dir flow scaffolded a new app, so session.end
    // carries it for adoption + scaffold-failure tracking.
    if (finalContext?.scaffolded) {
      analytics.setTag('scaffolded', true);
    }
    await analytics.shutdown(installerStatus);
    await adapter.stop();
  }
}
