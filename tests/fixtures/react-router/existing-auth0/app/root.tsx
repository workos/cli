import { Links, Meta, NavLink, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { Auth0Provider } from '@auth0/auth0-react';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
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
            <NavLink to="/">Home</NavLink> | <NavLink to="/about">About</NavLink> |{' '}
            <NavLink to="/dashboard">Dashboard</NavLink>
          </nav>
          {children}
        </Auth0Provider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}
