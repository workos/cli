/* Ruby/Rails integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';
import { SPINNER_MESSAGE } from '../../lib/framework-config.js';
import { analytics } from '../../utils/analytics.js';
import { INSTALLER_INTERACTION_EVENT_NAME } from '../../lib/constants.js';
import { initializeAgent, runAgent } from '../../lib/agent-interface.js';
import { getOrAskForWorkOSCredentials } from '../../utils/ui-utils.js';
import { basename } from 'node:path';
import { resolveRedirectUri, getSignInPath } from '../../lib/port-detection.js';
import { buildApplicationSetup } from '../../lib/authkit-application-setup.js';
import { writeCredentialsEnv } from '../../lib/env-writer.js';
import { resolveProjectEnvPath } from '../../lib/project-env.js';
import { getReference } from '../../lib/skills-assets.js';
import { buildSignInSection } from '../../lib/sign-in-route.js';

export const config: FrameworkConfig = {
  metadata: {
    name: 'Ruby (Rails)',
    integration: 'ruby',
    docsUrl: 'https://workos.com/docs/authkit/vanilla/ruby',
    skillName: 'workos-ruby',
    language: 'ruby',
    stability: 'experimental',
    priority: 55,
    packageManager: 'bundle',
    manifestFile: 'Gemfile',
  },

  detection: {
    packageName: 'rails',
    packageDisplayName: 'Rails',
    getVersion: () => undefined,
  },

  environment: {
    uploadToHosting: false,
    requiresApiKey: true,
    getEnvVars: (apiKey: string, clientId: string) => ({
      WORKOS_API_KEY: apiKey,
      WORKOS_CLIENT_ID: clientId,
    }),
  },

  analytics: {
    getTags: () => ({}),
  },

  prompts: {},

  ui: {
    successMessage: 'Ruby agent finished; integration verification pending',
    getOutroChanges: () => [
      'Requested SDK configuration, visible auth controls, and application session integration',
      'Requested login, callback, and safe logout routes preserving existing authorization',
    ],
    getOutroNextSteps: () => [
      'Review the diff and use the project’s documented launcher; a Gemfile does not verify startup behavior',
      'Verify visible auth controls, callback identity/account context, repeat login, and protected access after logout',
      'Visit the WorkOS Dashboard to manage users and settings',
    ],
  },
};

/**
 * Custom run function for Ruby/Rails — bypasses runAgentInstaller
 * since that assumes a JS project (package.json, node_modules, .env.local).
 */
export async function run(options: InstallerOptions): Promise<string> {
  if (options.debug) {
    enableDebugLogs();
  }

  options.emitter?.emit('status', {
    message: `Setting up WorkOS AuthKit for ${config.metadata.name}`,
  });

  analytics.capture(INSTALLER_INTERACTION_EVENT_NAME, {
    action: 'started agent integration',
    integration: config.metadata.integration,
  });

  // Get WorkOS credentials
  const { apiKey, clientId } = await getOrAskForWorkOSCredentials(options, config.environment.requiresApiKey);

  // The common installer owns URL provisioning after the agent, with a single
  // sandbox target and read-back. Never perform legacy pre-agent URL writes here.
  const redirectUri = resolveRedirectUri('ruby', options);
  const setup = buildApplicationSetup({
    clientId,
    redirectUri,
    homepageUrl: options.homepageUrl,
    signInPath: getSignInPath('ruby'),
  });
  writeCredentialsEnv(options.installDir, {
    WORKOS_API_KEY: apiKey,
    WORKOS_CLIENT_ID: clientId,
    WORKOS_REDIRECT_URI: redirectUri,
  });
  const envFile = basename(resolveProjectEnvPath(options.installDir));

  // Keep credentials out of the prompt/transcript; the agent can read the ignored file.
  const refContent = await getReference('workos-ruby');
  const prompt = `You are integrating WorkOS AuthKit into this Ruby on Rails application.

## Project Context

- Framework: Ruby (Rails)
- Language: Ruby

## Environment

The installer wrote the selected credentials to the gitignored ${envFile}:
Ensure this file is loaded before WorkOS initialization using the project's existing environment-loading convention (Rails does not load dotenv files by itself). Preserve unrelated settings. Never print secrets or commit them. Verify variable presence without displaying values.
The variables are:
- WORKOS_API_KEY
- WORKOS_CLIENT_ID
- WORKOS_REDIRECT_URI=${redirectUri}

## Integration Instructions

${refContent}

${buildSignInSection(config)}## Application integration requirements (take precedence over generic examples)

- Use callback ${redirectUri}, Initiate login ${setup.initiateLoginUri}, and sign-out return destination ${setup.signOutUri}. CORS origin is ${new URL(redirectUri).origin}. The sign-out return destination is not the logout action. Do not guess a different host/port from Puma when an explicit callback is supplied. Do not write dashboard settings; the installer configures the selected environment after agent execution.
- Add visible sign-in controls while signed out and signed-in account/logout controls in the existing layouts/navigation. Wire real routes, not unused SDK examples. Preserve existing routes; if the required sign-in path conflicts, report the conflict rather than silently replacing it or choosing an unregistered alternative.
- Trace the app's real identity, session, account scope, and active membership/role checks. The callback must establish that existing authenticated context, not merely store an unrelated token or replace current_user. Preserve existing authorization and cross-account boundaries.
- Do not invent account-linking, identity/account auto-creation, membership or role assignment policy. Ask the user for the mapping policy if absent; leave that integration pending rather than using User.find_or_create_by(email:) or a hardcoded identity. Preserve magic-link and passkey behavior; do not silently replace the authentication system.
- Ensure repeat login does not duplicate identities, accounts, or memberships under the approved policy.
- Implement safe logout using the app's session termination/cookie clearing and the installed SDK's supported session logout behavior. Use CSRF protection for local session mutation. Verify protected access is denied afterward, including replay of the old app session. Local cookie deletion is not global provider-session revocation. If the SDK cannot end the upstream session, report that limitation instead of claiming logout is complete.
- Add local route/session tests with synthetic identities and stubbed network where possible. Distinguish source changes from checks actually run; source strings and a successful agent exit are not behavioral proof. Report commands/results, unavailable checks, and pending policy decisions. Hosted AuthKit/browser flows remain unverified until actually exercised.

Report your progress using [STATUS] prefixes.

Begin integration now.`;

  // Initialize and run agent
  const agent = await initializeAgent(
    {
      workingDirectory: options.installDir,
      workOSApiKey: apiKey,
      workOSApiHost: 'https://api.workos.com',
    },
    options,
  );

  const agentResult = await runAgent(
    agent,
    prompt,
    options,
    {
      spinnerMessage: SPINNER_MESSAGE,
      successMessage: config.ui.successMessage,
      errorMessage: 'Integration failed',
    },
    options.emitter,
  );

  if (agentResult.error) {
    await analytics.shutdown('error');
    const message = agentResult.errorMessage || agentResult.error;
    throw new Error(message);
  }

  // Build completion summary
  const changes = config.ui.getOutroChanges({});
  const nextSteps = config.ui.getOutroNextSteps({});

  const lines: string[] = [
    'Ruby agent finished. Application behavior and hosted AuthKit flows are not verified.',
    `Credentials and callback written to ${envFile}; runtime loading is not verified.`,
    `Requested callback: ${redirectUri}`,
    'Application URL registration is handled separately by the installer after this step.',
    '',
    'Instructions given to the agent (not verified changes):',
    ...changes.map((c) => `• ${c}`),
    '',
    'Next steps:',
    ...nextSteps.map((s) => `• ${s}`),
    '',
    `Learn more: ${config.metadata.docsUrl}`,
    '',
    'Note: This installer uses an LLM agent to analyze and modify your project. Please review the changes made.',
  ];

  await analytics.shutdown('success');

  return lines.join('\n');
}
