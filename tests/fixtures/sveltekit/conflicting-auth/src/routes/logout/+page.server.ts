import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { sessionCookieName } from '$lib/auth';

export const actions: Actions = {
  default: async ({ cookies }) => {
    cookies.delete(sessionCookieName, { path: '/' });
    throw redirect(302, '/');
  },
};
