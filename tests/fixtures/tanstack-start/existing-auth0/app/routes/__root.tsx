import { Link, Outlet, createRootRoute } from '@tanstack/react-router';
import { Auth0Provider } from '@auth0/auth0-react';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>TanStack Start with Auth0</title>
      </head>
      <body>
        <Auth0Provider
          domain={import.meta.env.VITE_AUTH0_DOMAIN || ''}
          clientId={import.meta.env.VITE_AUTH0_CLIENT_ID || ''}
          authorizationParams={{
            redirect_uri: typeof window !== 'undefined' ? window.location.origin : '',
          }}
        >
          <nav>
            <Link to="/">Home</Link> | <Link to="/about">About</Link> | <Link to="/dashboard">Dashboard</Link>
          </nav>
          <Outlet />
        </Auth0Provider>
      </body>
    </html>
  );
}
