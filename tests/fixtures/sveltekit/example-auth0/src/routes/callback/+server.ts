import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Auth0 callback — exchanges code for tokens
// Agent should replace with WorkOS AuthKit callback
export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get('code');
  if (!code) throw error(400, 'Missing authorization code');

  const domain = process.env.AUTH0_DOMAIN ?? '';
  const clientId = process.env.AUTH0_CLIENT_ID ?? '';
  const clientSecret = process.env.AUTH0_CLIENT_SECRET ?? '';

  const tokenRes = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: 'http://localhost:5173/callback',
    }),
  });

  const tokens = await tokenRes.json();
  const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString());
  const session = Buffer.from(JSON.stringify({ sub: payload.sub, email: payload.email, name: payload.name })).toString(
    'base64',
  );

  cookies.set('auth0_session', session, { path: '/', httpOnly: true });
  throw redirect(302, '/');
};
