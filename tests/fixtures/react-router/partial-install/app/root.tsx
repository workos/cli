import { Links, Meta, NavLink, Outlet, Scripts, ScrollRestoration } from 'react-router';
// TODO: Complete AuthKit setup
// import { AuthKitProvider } from '@workos-inc/authkit-react-router';

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

export default function Root() {
  return <Outlet />;
}
