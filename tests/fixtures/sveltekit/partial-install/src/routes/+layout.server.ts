import type { LayoutServerLoad } from './$types';

// TODO: Load user from AuthKit session
// import { getSession } from '@workos/authkit-sveltekit';

export const load: LayoutServerLoad = async () => {
  // TODO: Return user from AuthKit session
  return { user: null };
};
