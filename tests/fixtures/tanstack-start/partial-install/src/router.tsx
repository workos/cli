import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
// TODO: Complete AuthKit integration
// import { AuthKitProvider } from '@workos-inc/authkit-react';

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
