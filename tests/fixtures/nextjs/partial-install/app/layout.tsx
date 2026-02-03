import Link from 'next/link';
// TODO: Set up AuthKit
// import { AuthKitProvider } from '@workos-inc/authkit-nextjs';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/">Home</Link> | <Link href="/about">About</Link> | <Link href="/dashboard">Dashboard</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
