import type { Handle } from '@sveltejs/kit';

// Auth0 session middleware — reads session cookie set by callback route
export const handle: Handle = async ({ event, resolve }) => {
  const session = event.cookies.get('auth0_session');
  if (session) {
    try {
      const decoded = JSON.parse(Buffer.from(session, 'base64').toString());
      event.locals.user = decoded;
    } catch {
      event.locals.user = null;
    }
  } else {
    event.locals.user = null;
  }
  return resolve(event);
};
