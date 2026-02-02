import type { LoaderFunctionArgs } from 'react-router';
import { runMiddleware, addSecurityHeaders } from '../middleware.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

  // Run custom middleware
  const middlewareResponse = await runMiddleware({
    ip,
    method: request.method,
    path: url.pathname,
  });

  if (middlewareResponse) {
    return middlewareResponse;
  }

  // Return dashboard data with custom headers
  const headers = addSecurityHeaders(new Headers());

  return new Response(JSON.stringify({ message: 'Dashboard data' }), {
    headers,
  });
}

export default function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      <p>Protected content would go here.</p>
    </div>
  );
}
