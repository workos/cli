import { createRouter, type Router } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export const getRouter = (): Router<typeof routeTree> => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
