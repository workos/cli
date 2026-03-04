// Auth0 configuration for SvelteKit
// This is a client-side Auth0 setup — the agent should replace with WorkOS AuthKit

export const auth0Config = {
  domain: process.env.AUTH0_DOMAIN ?? 'your-tenant.auth0.com',
  clientId: process.env.AUTH0_CLIENT_ID ?? 'your-auth0-client-id',
  redirectUri: 'http://localhost:5173/callback',
};
