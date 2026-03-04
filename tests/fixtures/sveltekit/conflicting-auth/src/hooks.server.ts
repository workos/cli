import type { Handle } from '@sveltejs/kit';
import { sessionCookieName, decodeSession } from '$lib/auth';

// Lucia v3 session validation handle
export const handle: Handle = async ({ event, resolve }) => {
  const sessionToken = event.cookies.get(sessionCookieName);

  if (!sessionToken) {
    event.locals.user = null;
    event.locals.session = null;
    return resolve(event);
  }

  const data = decodeSession(sessionToken);
  if (data) {
    event.locals.user = data.user;
    event.locals.session = data.session;
  } else {
    event.locals.user = null;
    event.locals.session = null;
    event.cookies.delete(sessionCookieName, { path: '/' });
  }

  return resolve(event);
};
