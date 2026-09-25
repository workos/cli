import type { FrameworkConfig } from './framework-config.js';
import { getSignInPath } from './port-detection.js';

/** Pin the sign-in route the installer saves as the Initiate login URI (Next.js has its own section). */
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
    `After you finish, the installer sets the WorkOS Initiate login URI to the app origin plus ${signInPath}. AuthKit sends users there when sign-in starts outside the app, such as from a password-reset email or an invitation. The route must exist at exactly ${signInPath}, must be public, and must start AuthKit sign-in through the SDK. It is never the callback route.`,
  ];
  // Client-only SDKs are the ones that need no API key.
  if (!environment.requiresApiKey) {
    lines.push(
      '',
      `This is a client-only app, so add a ${signInPath} client route that calls the SDK's signIn() as soon as the AuthKit client is ready, without a click (for example, in a useEffect). AuthKit keeps password-reset and invitation details through this redirect, so signIn() needs no extra arguments. If the app has a client router, register the route there and keep it public. At startup (vanilla JS) or inside useEffect in a mounted component (React), use an explicit positive pathname guard: if (window.location.pathname === '${signInPath}') { void signIn(); }. Wait until AuthKit is ready; a readiness condition can be combined with the pathname guard using &&. Keep the call directly in that branch, not in a click handler or another function. The installer checks that this specific route starts sign-in before saving its URI; a route declaration alone is not enough. Keep the existing sign-in button. Do not add a server route.`,
      '',
      "The installer registers WORKOS_REDIRECT_URI as the app's Redirect URI. The SDK defaults to the page origin instead, so pass that value explicitly. The installer also writes it to .env.local under the bundler's env prefix (VITE_WORKOS_REDIRECT_URI for Vite, REACT_APP_WORKOS_REDIRECT_URI for Create React App), with the client ID beside it. Read that variable and set it as redirectUri on AuthKitProvider or createClient().",
    );
  }
  return `${lines.join('\n')}\n\n`;
}
