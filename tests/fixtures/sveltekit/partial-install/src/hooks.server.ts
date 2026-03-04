import type { Handle } from '@sveltejs/kit';

// TODO: Complete AuthKit integration
// The SDK is installed but the handle is not wired up correctly.
// Need to use authkitHandle from @workos/authkit-sveltekit
// import { authkitHandle } from '@workos/authkit-sveltekit';

export const handle: Handle = async ({ event, resolve }) => {
  // TODO: Replace with authkitHandle or use sequence()
  return resolve(event);
};
