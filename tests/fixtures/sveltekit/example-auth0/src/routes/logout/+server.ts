import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Auth0 logout — clears session cookie
export const GET: RequestHandler = async ({ cookies }) => {
  cookies.delete('auth0_session', { path: '/' });
  throw redirect(302, '/');
};
