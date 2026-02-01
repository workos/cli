import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/about')({
  component: About,
});

function About() {
  return (
    <div>
      <h1>About</h1>
      <p>This is an existing TanStack Start application with Auth0.</p>
    </div>
  );
}
