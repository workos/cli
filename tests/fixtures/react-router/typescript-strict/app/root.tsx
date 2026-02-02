import { Links, Meta, NavLink, Outlet, Scripts, ScrollRestoration } from 'react-router';
import type { ReactNode, JSX } from 'react';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps): JSX.Element {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <nav>
          <NavLink to="/">Home</NavLink> | <NavLink to="/about">About</NavLink> |{' '}
          <NavLink to="/dashboard">Dashboard</NavLink>
        </nav>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root(): JSX.Element {
  return <Outlet />;
}
