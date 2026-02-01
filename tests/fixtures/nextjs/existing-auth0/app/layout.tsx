import Link from 'next/link';
import { UserProvider } from '@auth0/nextjs-auth0/client';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <UserProvider>
          <nav>
            <Link href="/">Home</Link> | <Link href="/about">About</Link> | <Link href="/dashboard">Dashboard</Link> |{' '}
            <a href="/api/auth/login">Login</a> | <a href="/api/auth/logout">Logout</a>
          </nav>
          {children}
        </UserProvider>
      </body>
    </html>
  );
}
