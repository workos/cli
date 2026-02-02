import { createFileRoute } from '@tanstack/react-router';
import type { JSX } from 'react';

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
});

function Dashboard(): JSX.Element {
  return (
    <div className="container">
      <h1>Dashboard</h1>
      <p>This is a protected dashboard page.</p>
      <div className="stats">
        <div className="stat">
          <h3>Users</h3>
          <p>1,234</p>
        </div>
        <div className="stat">
          <h3>Revenue</h3>
          <p>$12,345</p>
        </div>
      </div>
    </div>
  );
}
