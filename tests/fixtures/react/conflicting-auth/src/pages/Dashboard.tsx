import { useAuth } from '../auth/AuthProvider';

export function Dashboard() {
  const { isAuthenticated, user, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div>
        <h1>Dashboard</h1>
        <p>Please log in to view the dashboard.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome back, {user?.name}!</p>
      <p>Role: {user?.role}</p>
      <p>Theme: {user?.preferences.theme}</p>
    </div>
  );
}
