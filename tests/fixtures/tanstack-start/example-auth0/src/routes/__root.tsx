import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';
import { Auth0Provider } from '@auth0/auth0-react';
import appCss from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'TanStack Start App' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Auth0Provider
          domain="your-tenant.auth0.com"
          clientId="your-client-id"
          authorizationParams={{
            redirect_uri: typeof window !== 'undefined' ? window.location.origin : '',
          }}
        >
          {children}
        </Auth0Provider>
        <Scripts />
      </body>
    </html>
  );
}
