import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { sessionCookieName, createSession, encodeSession } from '$lib/auth';

// Demo users — Lucia would normally validate against a database
const users = [{ id: '1', username: 'admin', password: 'password123' }];

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const formData = await request.formData();
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    const user = users.find((u) => u.username === username && u.password === password);
    if (!user) return fail(400, { message: 'Invalid credentials' });

    const sessionData = createSession(user.id, user.username);
    cookies.set(sessionCookieName, encodeSession(sessionData), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });

    throw redirect(302, '/dashboard');
  },
};
