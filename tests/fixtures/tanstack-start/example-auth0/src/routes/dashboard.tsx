import { createFileRoute } from '@tanstack/react-router';
import { useAuth0, withAuthenticationRequired } from '@auth0/auth0-react';

export const Route = createFileRoute('/dashboard')({
  component: withAuthenticationRequired(Dashboard),
});

function Dashboard() {
  const { user } = useAuth0();

  return (
    <div className="container">
      <h1>Dashboard</h1>
      <p>Welcome back, {user?.name}!</p>
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
