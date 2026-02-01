import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <div>
      <h1>Welcome to TanStack Start</h1>
      <p>This is a fresh TanStack Start application.</p>
    </div>
  );
}
