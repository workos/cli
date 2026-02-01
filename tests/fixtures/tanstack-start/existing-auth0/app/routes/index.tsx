import { createFileRoute } from '@tanstack/react-router';
import { useAuth0 } from '@auth0/auth0-react';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  const { isAuthenticated, loginWithRedirect, logout } = useAuth0();

  return (
    <div>
      <h1>Home</h1>
      <p>Welcome to the home page.</p>
      {isAuthenticated ? (
        <button onClick={() => logout()}>Logout</button>
      ) : (
        <button onClick={() => loginWithRedirect()}>Login</button>
      )}
    </div>
  );
}
