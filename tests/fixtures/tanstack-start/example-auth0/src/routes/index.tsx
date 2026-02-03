import { createFileRoute, Link } from '@tanstack/react-router';
import { useAuth0 } from '@auth0/auth0-react';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  const { isAuthenticated, loginWithRedirect, logout, user } = useAuth0();

  return (
    <div className="container">
      <h1>Welcome to My App</h1>
      <p>This is an existing TanStack Start application with Auth0.</p>

      {isAuthenticated ? (
        <div>
          <p>Hello, {user?.name}!</p>
          <button onClick={() => logout()}>Log Out</button>
          <nav>
            <Link to="/dashboard">Go to Dashboard</Link>
          </nav>
        </div>
      ) : (
        <button onClick={() => loginWithRedirect()}>Log In</button>
      )}
    </div>
  );
}
