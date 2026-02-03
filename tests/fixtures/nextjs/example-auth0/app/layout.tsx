'use client';

import Link from 'next/link';
import { UserProvider, useUser } from '@auth0/nextjs-auth0/client';

function Nav() {
  const { user, isLoading } = useUser();

  return (
    <nav>
      <Link href="/">Home</Link> | <Link href="/about">About</Link> | <Link href="/dashboard">Dashboard</Link> |{' '}
      {!isLoading && (user ? <a href="/api/auth/logout">Logout</a> : <a href="/api/auth/login">Login</a>)}
    </nav>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <UserProvider>
          <Nav />
          {children}
        </UserProvider>
      </body>
    </html>
  );
}
