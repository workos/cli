import { createFileRoute } from '@tanstack/react-router';
import { getSecurityContext, validateRequest } from '../middleware.server';

export const Route = createFileRoute('/dashboard')({
  loader: async () => {
    // Get security context from server
    const securityContext = await getSecurityContext();

    // Validate the request through our middleware
    const validation = await validateRequest({
      data: {
        ip: securityContext.ip,
        path: '/dashboard',
      },
    });

    if (!validation.valid) {
      throw new Error(validation.error ?? 'Request validation failed');
    }

    return {
      securityContext,
      stats: {
        users: 1234,
        revenue: 12345,
      },
    };
  },
  component: Dashboard,
});

function Dashboard() {
  const { stats } = Route.useLoaderData();

  return (
    <div className="container">
      <h1>Dashboard</h1>
      <p>This is a protected dashboard page.</p>
      <div className="stats">
        <div className="stat">
          <h3>Users</h3>
          <p>{stats.users.toLocaleString()}</p>
        </div>
        <div className="stat">
          <h3>Revenue</h3>
          <p>${stats.revenue.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}
