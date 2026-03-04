import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Auth0 login redirect — agent should replace with WorkOS AuthKit
export const GET: RequestHandler = async () => {
  const domain = process.env.AUTH0_DOMAIN ?? '';
  const clientId = process.env.AUTH0_CLIENT_ID ?? '';
  const callbackUrl = encodeURIComponent('http://localhost:5173/callback');
  const url = `https://${domain}/authorize?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=openid%20profile%20email`;
  throw redirect(302, url);
};
