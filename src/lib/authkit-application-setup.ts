import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnvFile } from '../utils/env-parser.js';
import { refreshIfExpired } from './command-auth.js';
import { fetchTeamEnvironments, resolveEnvironmentTarget } from './environment-target.js';
import { dashboardGraphqlRequest } from './dashboard-graphql.js';
import { getOperation, resolveExecutableDocument } from '../catalog/operation.js';

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
 * Native installer configuration, never agent-controlled shell access.
 * Only the default application whose client ID matches this install in a
 * confirmed sandbox can be changed through the dashboard. Without a dashboard
 * session, only the callback is registered, using the API key as the sole target.
 * These paths are exclusive: never mix API-key and client-ID-targeted writes.
 * Existing defaults/URLs are never replaced
 * with different values. Other cases return concrete manual setup instructions.
 */
export async function configureAuthkitApplication(
  setup: AuthkitApplicationSetup,
  expectedClientId: string,
  apiKey?: string,
): Promise<AuthkitApplicationSetup> {
  const pending = (reason: string): AuthkitApplicationSetup => ({ ...setup, verified: false, reason });
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
  const session = await refreshIfExpired().catch(() => {
    throw new Error('Could not check the dashboard session. No application URLs were changed. Retry setup.');
  });
  if (!session) {
    if (!apiKey) {
      return pending(
        'No dashboard session or API key is available. No application URLs were changed. Configure and verify all three URLs in the dashboard.',
      );
    }
    if (!apiKey.startsWith('sk_test_')) {
      throw new Error(
        'Automatic callback registration requires a sandbox API key (sk_test_). Configure production URLs explicitly in the dashboard.',
      );
    }
    // Use the existing REST callback operation for API-key-only and one-shot
    // installs. Return here: a key and a client ID may identify different envs,
    // so this branch must never continue into client-ID-targeted dashboard writes.
    try {
      const { createWorkOSClient } = await import('./workos-client.js');
      await createWorkOSClient(apiKey).redirectUris.add(setup.redirectUri);
    } catch {
      // A missing callback makes sign-in unusable. Do not report install success.
      throw new Error('Could not register the callback URL. Check the API key and connection, then retry setup.');
    }
    return {
      ...pending(
        'Callback registered using the API key. Sign-out URI and Initiate login URI still require dashboard setup and verification. Sign in to the CLI (and claim the environment if needed) to manage those settings.',
      ),
      callbackRegistered: true,
    };
  }

  try {
    const environments = await fetchTeamEnvironments(session.accessToken);
    const matches = environments.filter((environment) => environment.clientId === setup.clientId);
    if (matches.length !== 1) return pending('Could not uniquely match the app client ID to a WorkOS environment.');
    const environment = matches[0];
    if (environment.sandbox !== true)
      return pending(
        'Automatic URL setup is restricted to sandbox environments. Configure this environment explicitly in the dashboard.',
      );
    const target = await resolveEnvironmentTarget(session.accessToken, {
      flagValue: environment.id,
      forMutation: true,
    });
    const request = <T>(name: string, variables: Record<string, unknown>): Promise<T> =>
      dashboardGraphqlRequest<T>(resolveExecutableDocument(getOperation(name)), {
        token: session.accessToken,
        environmentId: target.environmentId,
        variables,
      });
    const readApplication = async (): Promise<Application> => {
      const data = await request<{ defaultUserlandApplication: Application | null }>('defaultAuthkitApplication', {
        environmentId: target.environmentId,
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
      ) {
        throw new Error('Application configuration unavailable');
      }
      return application;
    };
    const original = await readApplication();
    const defaults = original.logoutUris.filter((uri) => uri.isDefault);
    if (defaults.length > 1 || defaults.some((uri) => !isSignOutDestination(uri.uri))) {
      return pending(
        'An existing sign-out default differs from this app. It was left unchanged; confirm the intended default in the dashboard.',
      );
    }
    if (original.initiateLoginUri && original.initiateLoginUri !== setup.initiateLoginUri) {
      return pending(
        'An existing Initiate login URI differs from this app. It was left unchanged; confirm the intended sign-in route in the dashboard.',
      );
    }

    const needsLogout = !original.logoutUris.some((uri) => isSignOutDestination(uri.uri) && uri.isDefault);
    if (needsLogout) {
      const logoutUris = original.logoutUris.map((uri) => ({ ...uri, isDefault: isSignOutDestination(uri.uri) }));
      if (!logoutUris.some((uri) => isSignOutDestination(uri.uri)))
        logoutUris.push({ uri: setup.signOutUri, isDefault: true });
      const input = { applicationId: original.id, logoutUris };
      const validate = await request<{ setUserlandApplicationLogoutUris: { __typename: string } }>(
        'setAuthkitApplicationLogoutUris',
        { input: { ...input, dryRun: true } },
      );
      if (validate.setUserlandApplicationLogoutUris.__typename !== 'LogoutUrisSet') {
        return pending('Sign-out URL validation failed. Existing settings were not changed.');
      }
      // Full-list setters have no compare-and-swap API. Detect changes during
      // validation rather than knowingly overwriting another editor's work.
      const current = await readApplication();
      if (JSON.stringify(current) !== JSON.stringify(original)) {
        return pending('Application settings changed during setup. Recheck them before applying changes.');
      }
      const saved = await request<{ setUserlandApplicationLogoutUris: { __typename: string } }>(
        'setAuthkitApplicationLogoutUris',
        { input: { ...input, dryRun: false } },
      );
      if (saved.setUserlandApplicationLogoutUris.__typename !== 'LogoutUrisSet') {
        return pending('Could not save the sign-out URL. Check the dashboard before continuing.');
      }
    }
    if (
      original.initiateLoginUri !== setup.initiateLoginUri ||
      (setup.homepageUrl !== undefined && original.appHomepageUrl !== setup.homepageUrl)
    ) {
      const current = await readApplication();
      if (
        current.id !== original.id ||
        (current.initiateLoginUri && current.initiateLoginUri !== setup.initiateLoginUri)
      ) {
        return pending('The application or Initiate login URI changed during setup. It was not overwritten.');
      }
      if (
        !current.initiateLoginUri ||
        (setup.homepageUrl !== undefined && current.appHomepageUrl !== setup.homepageUrl)
      ) {
        const saved = await request<{ updateUserlandApplication: { __typename: string } }>('updateAuthkitApplication', {
          input: {
            applicationId: original.id,
            ...(!current.initiateLoginUri ? { initiateLoginUri: setup.initiateLoginUri } : {}),
            ...(setup.homepageUrl !== undefined ? { appHomepageUrl: setup.homepageUrl } : {}),
          },
        });
        if (saved.updateUserlandApplication.__typename !== 'UserlandApplicationUpdated') {
          return pending(
            'Could not save application URLs. Check the Initiate login URI and any requested homepage in the dashboard.',
          );
        }
      }
    }
    if (!original.redirectUris.some((uri) => uri.uri === setup.redirectUri)) {
      const current = await readApplication();
      if (current.id !== original.id) return pending('The application changed during setup. Recheck its URLs.');
      if (!current.redirectUris.some((uri) => uri.uri === setup.redirectUri)) {
        const input = {
          applicationId: current.id,
          redirectUris: [
            ...current.redirectUris,
            { uri: setup.redirectUri, isDefault: current.redirectUris.length === 0 },
          ],
        };
        const validated = await request<{ setRedirectUris: { __typename: string } }>('setRedirectUris', {
          input: { ...input, dryRun: true },
        });
        if (validated.setRedirectUris.__typename !== 'RedirectUrisSet')
          return pending('Callback URL validation failed. Read back all settings in the dashboard.');
        if (JSON.stringify(await readApplication()) !== JSON.stringify(current))
          return pending('Application settings changed during setup. Recheck them before applying changes.');
        const saved = await request<{ setRedirectUris: { __typename: string } }>('setRedirectUris', {
          input: { ...input, dryRun: false },
        });
        if (saved.setRedirectUris.__typename !== 'RedirectUrisSet')
          return pending('Could not save the callback URL. Read back all settings in the dashboard.');
      }
    }
    const saved = await readApplication();
    const redirectsPreserved = original.redirectUris.every((old) =>
      saved.redirectUris.some((uri) => uri.uri === old.uri && (!old.isDefault || uri.isDefault)),
    );
    const preserved = original.logoutUris.every((old) =>
      saved.logoutUris.some((uri) => uri.uri === old.uri && (!old.isDefault || uri.isDefault)),
    );
    if (
      saved.id !== original.id ||
      !preserved ||
      !redirectsPreserved ||
      saved.logoutUris.filter((uri) => uri.isDefault).length !== 1 ||
      !saved.redirectUris.some((uri) => uri.uri === setup.redirectUri) ||
      !saved.logoutUris.some((uri) => isSignOutDestination(uri.uri) && uri.isDefault) ||
      saved.initiateLoginUri !== setup.initiateLoginUri ||
      (setup.homepageUrl !== undefined && saved.appHomepageUrl !== setup.homepageUrl)
    ) {
      return pending(
        'URL read-back did not match the required settings. Check the dashboard before testing authentication.',
      );
    }
    return {
      ...setup,
      signOutUri: saved.logoutUris.find((uri) => uri.isDefault)!.uri,
      callbackRegistered: true,
      verified: true,
    };
  } catch {
    // Never claim success based on a write response, expose credentials, or
    // print internal API errors. A partial write requires manual read-back too.
    return pending(
      'Could not verify WorkOS application settings. Check dashboard access and read back all three URLs before continuing.',
    );
  }
}
