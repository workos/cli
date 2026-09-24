import type { Integration } from './constants.js';
import { getSignInPath } from './port-detection.js';

const CLIENT_ONLY_INTEGRATIONS = new Set(['react', 'vanilla-js']);

/** Pin the sign-in route the installer saves as the Initiate login URI (Next.js has its own section). */
export function buildSignInSection(integration: Integration): string {
  const signInPath = getSignInPath(integration);
  if (!signInPath || integration === 'nextjs') return '';
  const lines = [
    '## Sign-in route (Initiate login URI)',
    '',
    `After you finish, the installer sets the WorkOS Initiate login URI to the app origin plus ${signInPath}. AuthKit sends users there when sign-in starts outside the app, such as from a password-reset email or an invitation. The route must exist at exactly ${signInPath}, must be public, and must start AuthKit sign-in through the SDK. It is never the callback route.`,
  ];
  if (CLIENT_ONLY_INTEGRATIONS.has(integration)) {
    lines.push(
      '',
      `This is a client-only app, so add a ${signInPath} client route that calls the SDK's signIn() as soon as the AuthKit client is ready, without a click (for example, in a useEffect). AuthKit keeps password-reset and invitation details through this redirect, so signIn() needs no extra arguments. If the app has a client router, register ${signInPath} in it. If it has none, check window.location.pathname at startup. Keep the existing sign-in button. Do not add a server route.`,
      '',
      "The installer registers WORKOS_REDIRECT_URI as the app's Redirect URI. The SDK defaults to the page origin instead, so pass that value explicitly: expose it with the build tool's env prefix (for example, VITE_WORKOS_REDIRECT_URI) and set redirectUri on AuthKitProvider or createClient().",
    );
  }
  return `${lines.join('\n')}\n\n`;
}
