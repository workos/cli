import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnvFile } from '../utils/env-parser.js';
import { refreshIfExpired } from './command-auth.js';
import { fetchTeamEnvironments } from './environment-target.js';
import { dashboardGraphqlRequest } from './dashboard-graphql.js';
import { getOperation, resolveExecutableDocument } from '../catalog/operation.js';
import { InstallDeclinedError } from './installer-errors.js';
import { setHomepageUrl } from './workos-management.js';

export interface AuthkitApplicationSetup {
  clientId: string;
  redirectUri: string;
  signOutUri: string;
  initiateLoginUri: string;
  homepageUrl?: string;
  verified: boolean;
  /** The callback was registered; this alone does not verify the other URLs or browser flows. */
  callbackRegistered?: boolean;
  reason?: string;
}

interface Uri {
  id?: string | null;
  uri: string;
  isDefault?: boolean | null;
}

interface Application {
  id: string;
  clientId: string;
  redirectUris: Uri[];
  logoutUris: Uri[];
  initiateLoginUri: string | null;
  appHomepageUrl?: string | null;
}

/** Use the app's saved callback, not the active profile or a guessed localhost port. */
export async function readNextjsApplicationSetup(
  installDir: string,
  homepageUrl?: string,
): Promise<AuthkitApplicationSetup> {
  const env = parseEnvFile(await readFile(join(installDir, '.env.local'), 'utf8'));
  const clientId = env.WORKOS_CLIENT_ID;
  const redirectUri = env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
  if (!clientId || !redirectUri) throw new Error('Missing AuthKit client ID or callback URL in .env.local.');
  const callback = new URL(redirectUri);
  if (!['http:', 'https:'].includes(callback.protocol) || callback.username || callback.password || callback.hash) {
    throw new Error('The AuthKit callback must be an HTTP(S) URL without credentials or a fragment.');
  }
  if (callback.pathname.replace(/\/$/, '') === '/sign-in') {
    throw new Error(
      'The OAuth callback cannot use /sign-in; that route starts authentication. Use a separate callback.',
    );
  }
  if (homepageUrl !== undefined) {
    const homepage = new URL(homepageUrl);
    if (!['http:', 'https:'].includes(homepage.protocol) || homepage.username || homepage.password) {
      throw new Error('The homepage must be an HTTP(S) URL without credentials.');
    }
  }
  return {
    clientId,
    redirectUri,
    ...(homepageUrl !== undefined ? { homepageUrl } : {}),
    signOutUri: `${callback.origin}/`,
    initiateLoginUri: `${callback.origin}/sign-in`,
    verified: false,
  };
}

/**
 * Callback registration is mandatory; remaining settings may require manual setup.
 * Choose one write target: a uniquely matched dashboard sandbox, or the sandbox
 * API key when no session/team match exists. Never fall back after dashboard writes.
 */
export async function configureAuthkitApplication(
  setup: AuthkitApplicationSetup,
  expectedClientId: string,
  apiKey?: string,
): Promise<AuthkitApplicationSetup> {
  let callbackRegistered = false;
  const pending = (reason: string): AuthkitApplicationSetup => {
    if (!callbackRegistered) {
      throw new InstallDeclinedError(`Callback URL is not registered or verified. ${reason}`, 'callback_unregistered');
    }
    return { ...setup, callbackRegistered, verified: false, reason };
  };
  const isSignOutDestination = (uri: string): boolean => {
    try {
      return new URL(uri).href === new URL(setup.signOutUri).href;
    } catch {
      return false;
    }
  };
  if (setup.clientId !== expectedClientId) {
    return pending('The app client ID changed during installation. Confirm the application before configuring it.');
  }
  const registerApiCallback = async (): Promise<AuthkitApplicationSetup> => {
    if (!apiKey)
      return pending(
        'No usable dashboard environment or API key is available. Configure the callback in the dashboard.',
      );
    if (!apiKey.startsWith('sk_test_')) {
      return pending(
        'Automatic callback registration requires a sandbox API key (sk_test_). Configure production URLs explicitly in the dashboard.',
      );
    }
    try {
      const { createWorkOSClient } = await import('./workos-client.js');
      await createWorkOSClient(apiKey).redirectUris.add(setup.redirectUri);
    } catch {
      return pending('Could not register the callback URL. Check the API key and connection, then retry setup.');
    }
    callbackRegistered = true;
    try {
      await setHomepageUrl(apiKey, setup.homepageUrl ?? new URL(setup.redirectUri).origin, {
        preserveExisting: setup.homepageUrl === undefined,
      });
    } catch {
      return pending(
        'Callback registered using the API key, but homepage setup failed. Check the Homepage URL, Sign-out URI and Initiate login URI in the dashboard.',
      );
    }
    return pending(
      'Callback registered using the API key. Sign-out URI and Initiate login URI still require dashboard setup and verification. Sign in to the correct team (and claim the environment if needed) to manage those settings.',
    );
  };
  const session = await refreshIfExpired().catch(() => {
    throw new InstallDeclinedError(
      'Callback URL is not registered or verified. Could not check the dashboard session. Retry setup.',
      'callback_unregistered',
    );
  });
  if (!session) return registerApiCallback();

  try {
    const environments = await fetchTeamEnvironments(session.accessToken);
    const matches = environments.filter((environment) => environment.clientId === setup.clientId);
    // A session for another team must not disable API-key-only onboarding. No
    // dashboard mutation has happened, and this branch returns before any can.
    if (matches.length === 0) return registerApiCallback();
    if (matches.length !== 1) return pending('Could not uniquely match the app client ID to a WorkOS environment.');
    const environment = matches[0];
    // Already validated by the team catalog and the application read below.
    // Do not resolve again: that would re-fetch and mutate stored profiles.
    const environmentId = environment.id;
    const request = <T>(name: string, variables: Record<string, unknown>): Promise<T> =>
      dashboardGraphqlRequest<T>(resolveExecutableDocument(getOperation(name)), {
        token: session.accessToken,
        environmentId,
        variables,
      });
    const readApplication = async (): Promise<Application> => {
      const data = await request<{ defaultUserlandApplication: Application | null }>('defaultAuthkitApplication', {
        environmentId,
      });
      const application = data.defaultUserlandApplication;
      if (
        !application ||
        application.clientId !== setup.clientId ||
        !application.id ||
        !Array.isArray(application.logoutUris) ||
        !Array.isArray(application.redirectUris) ||
        !(application.initiateLoginUri === null || typeof application.initiateLoginUri === 'string') ||
        !application.logoutUris.every(
          (uri) => typeof uri.uri === 'string' && (uri.isDefault === null || typeof uri.isDefault === 'boolean'),
        ) ||
        !application.redirectUris.every(
          (uri) => typeof uri.uri === 'string' && (uri.isDefault === null || typeof uri.isDefault === 'boolean'),
        )
      )
        throw new Error('Application configuration unavailable');
      return application;
    };
    let original = await readApplication();
    if (environment.sandbox !== true) {
      // Production can use an already registered callback, but is read-only here.
      callbackRegistered = original.redirectUris.some((uri) => uri.uri === setup.redirectUri);
      return pending(
        'Automatic URL setup is restricted to sandbox environments. Configure this environment explicitly in the dashboard.',
      );
    }

    // Register and verify the additive callback FIRST. Conflicting settings for
    // other apps may block their own updates, but must not block basic sign-in.
    if (!original.redirectUris.some((uri) => uri.uri === setup.redirectUri)) {
      const input = {
        applicationId: original.id,
        redirectUris: [
          ...original.redirectUris,
          { uri: setup.redirectUri, isDefault: original.redirectUris.length === 0 },
        ],
      };
      const validated = await request<{ setRedirectUris: { __typename: string } }>('setRedirectUris', {
        input: { ...input, dryRun: true },
      });
      if (validated.setRedirectUris.__typename !== 'RedirectUrisSet') return pending('Callback URL validation failed.');
      if (JSON.stringify(await readApplication()) !== JSON.stringify(original))
        return pending('Application settings changed during setup. Recheck them before applying changes.');
      const written = await request<{ setRedirectUris: { __typename: string } }>('setRedirectUris', {
        input: { ...input, dryRun: false },
      });
      if (written.setRedirectUris.__typename !== 'RedirectUrisSet') return pending('Could not save the callback URL.');
      const saved = await readApplication();
      if (
        saved.id !== original.id ||
        !saved.redirectUris.some((uri) => uri.uri === setup.redirectUri) ||
        !original.redirectUris.every((old) =>
          saved.redirectUris.some((uri) => uri.uri === old.uri && (!old.isDefault || uri.isDefault)),
        )
      ) {
        return pending('Callback read-back did not match the required settings.');
      }
      original = saved;
    }
    callbackRegistered = true;

    const reasons: string[] = [];
    const defaults = original.logoutUris.filter((uri) => uri.isDefault);
    const signOutConflict = defaults.length > 1 || defaults.some((uri) => !isSignOutDestination(uri.uri));
    const initiateConflict = !!original.initiateLoginUri && original.initiateLoginUri !== setup.initiateLoginUri;
    if (signOutConflict)
      reasons.push(
        'An existing sign-out default differs from this app. It was left unchanged; confirm the intended default in the dashboard.',
      );
    if (initiateConflict)
      reasons.push(
        'An existing Initiate login URI differs from this app. It was left unchanged; confirm the intended sign-in route in the dashboard.',
      );

    const needsLogout =
      !signOutConflict && !original.logoutUris.some((uri) => isSignOutDestination(uri.uri) && uri.isDefault);
    if (needsLogout) {
      const logoutUris = original.logoutUris.map((uri) => ({ ...uri, isDefault: isSignOutDestination(uri.uri) }));
      if (!logoutUris.some((uri) => isSignOutDestination(uri.uri)))
        logoutUris.push({ uri: setup.signOutUri, isDefault: true });
      const input = { applicationId: original.id, logoutUris };
      const validated = await request<{ setUserlandApplicationLogoutUris: { __typename: string } }>(
        'setAuthkitApplicationLogoutUris',
        { input: { ...input, dryRun: true } },
      );
      if (validated.setUserlandApplicationLogoutUris.__typename !== 'LogoutUrisSet')
        return pending('Sign-out URL validation failed. Its settings were not changed.');
      if (JSON.stringify(await readApplication()) !== JSON.stringify(original))
        return pending('Application settings changed during setup. Recheck them before applying changes.');
      const saved = await request<{ setUserlandApplicationLogoutUris: { __typename: string } }>(
        'setAuthkitApplicationLogoutUris',
        { input: { ...input, dryRun: false } },
      );
      if (saved.setUserlandApplicationLogoutUris.__typename !== 'LogoutUrisSet')
        return pending('Could not save the sign-out URL. Check the dashboard before continuing.');
    }
    const needsInitiate = !initiateConflict && original.initiateLoginUri !== setup.initiateLoginUri;
    const homepageValue = setup.homepageUrl ?? (original.appHomepageUrl || new URL(setup.redirectUri).origin);
    const needsHomepage = original.appHomepageUrl !== homepageValue;
    if (needsInitiate || needsHomepage) {
      // Best-effort recheck: UpdateUserlandApplicationInput has no version or
      // expected-value precondition, so this is not an atomic compare-and-set.
      const current = await readApplication();
      if (
        current.id !== original.id ||
        (needsInitiate && current.initiateLoginUri && current.initiateLoginUri !== setup.initiateLoginUri)
      ) {
        return pending('The application or Initiate login URI changed during setup. It was not overwritten.');
      }
      if (
        needsHomepage &&
        current.appHomepageUrl !== original.appHomepageUrl &&
        current.appHomepageUrl !== homepageValue
      ) {
        return pending('The homepage URL changed during setup. It was not overwritten.');
      }
      const updateHomepage = needsHomepage && current.appHomepageUrl !== homepageValue;
      if ((needsInitiate && !current.initiateLoginUri) || updateHomepage) {
        const saved = await request<{ updateUserlandApplication: { __typename: string } }>('updateAuthkitApplication', {
          input: {
            applicationId: original.id,
            ...(needsInitiate && !current.initiateLoginUri ? { initiateLoginUri: setup.initiateLoginUri } : {}),
            ...(updateHomepage ? { appHomepageUrl: homepageValue } : {}),
          },
        });
        if (saved.updateUserlandApplication.__typename !== 'UserlandApplicationUpdated')
          return pending('Could not save application URLs. Check the dashboard before continuing.');
      }
    }
    const saved = await readApplication();
    callbackRegistered = saved.id === original.id && saved.redirectUris.some((uri) => uri.uri === setup.redirectUri);
    if (!callbackRegistered) return pending('Callback read-back did not match the required settings.');
    if (reasons.length) return pending(reasons.join(' '));
    if (
      !original.redirectUris.every((old) =>
        saved.redirectUris.some((uri) => uri.uri === old.uri && (!old.isDefault || uri.isDefault)),
      ) ||
      !original.logoutUris.every((old) =>
        saved.logoutUris.some((uri) => uri.uri === old.uri && (!old.isDefault || uri.isDefault)),
      ) ||
      saved.logoutUris.filter((uri) => uri.isDefault).length !== 1 ||
      !saved.logoutUris.some((uri) => isSignOutDestination(uri.uri) && uri.isDefault) ||
      saved.initiateLoginUri !== setup.initiateLoginUri ||
      saved.appHomepageUrl !== homepageValue
    )
      return pending(
        'URL read-back did not match the required settings. Check the dashboard before testing authentication.',
      );
    return {
      ...setup,
      signOutUri: saved.logoutUris.find((uri) => uri.isDefault)!.uri,
      callbackRegistered,
      verified: true,
    };
  } catch (error) {
    if (error instanceof InstallDeclinedError) throw error;
    // Callback failures are fatal. Once it is confirmed, other settings may be
    // reported as incomplete, without exposing private backend errors or switching targets.
    return pending(
      'Could not verify WorkOS application settings. Check dashboard access and read back all three URLs before continuing.',
    );
  }
}
