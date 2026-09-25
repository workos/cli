import type { FrameworkConfig } from './framework-config.js';
import { getSignInPath } from './port-detection.js';

/** Pin the intended Initiate login route (Next.js has its own section). */
export function buildSignInSection({
  metadata,
  environment,
}: Pick<FrameworkConfig, 'metadata' | 'environment'>): string {
  const { integration } = metadata;
  const signInPath = getSignInPath(integration);
  if (!signInPath || integration === 'nextjs') return '';
  const lines = [
    '## Sign-in route (Initiate login URI)',
    '',
    `The intended WorkOS Initiate login URI is the app origin plus ${signInPath}. AuthKit sends users there when sign-in starts outside the app, such as from a password-reset email or an invitation. The route must exist at exactly ${signInPath}, must be public, and must start AuthKit sign-in through the SDK. It is never the callback route.`,
  ];
  // Client-only SDKs are the ones that need no API key.
  if (!environment.requiresApiKey) {
    lines.push(
      '',
      `This is a client-only app, so add a ${signInPath} client route that calls the SDK's signIn() as soon as the AuthKit client is ready, without a click. Use the app's existing router and component conventions; without a router, handle this pathname at startup. AuthKit keeps password-reset and invitation details through this redirect, so signIn() needs no extra arguments. Keep the existing sign-in button. Do not add a server route. The installer leaves the Initiate login URI unchanged: ask the user to open ${signInPath} while signed out, confirm automatic sign-in in the browser, and then set this URI in the WorkOS dashboard.`,
      '',
      "The installer registers WORKOS_REDIRECT_URI as the app's Redirect URI. The SDK defaults to the page origin instead, so pass that value explicitly. The installer also writes it to .env.local under the bundler's env prefix (VITE_WORKOS_REDIRECT_URI for Vite, REACT_APP_WORKOS_REDIRECT_URI for Create React App), with the client ID beside it. Read that variable and set it as redirectUri on AuthKitProvider or createClient().",
    );
  }
  return `${lines.join('\n')}\n\n`;
}
