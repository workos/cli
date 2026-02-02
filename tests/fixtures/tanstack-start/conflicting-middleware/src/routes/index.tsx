import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <div className="container">
      <h1>Welcome to My App</h1>
      <p>This is an existing TanStack Start application with custom middleware.</p>
      <nav>
        <Link to="/dashboard">Go to Dashboard</Link>
      </nav>
    </div>
  );
}
