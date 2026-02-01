'use client';

import { useUser } from '@auth0/nextjs-auth0/client';

export default function Dashboard() {
  const { user, isLoading, error } = useUser();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  if (!user) {
    return (
      <main>
        <h1>Dashboard</h1>
        <p>Please log in to view the dashboard.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Dashboard</h1>
      <p>Welcome, {user.name}!</p>
    </main>
  );
}
