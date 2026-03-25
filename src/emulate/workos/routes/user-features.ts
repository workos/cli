import { type RouteContext, notFound } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatAuthorizedApplication, formatConnectedAccount, formatPipeConnection } from '../helpers.js';

export function userFeatureRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.get('/user_management/users/:user_id/authorized_applications', (c) => {
    const user = ws.users.get(c.req.param('user_id'));
    if (!user) throw notFound('User');

    const apps = ws.authorizedApplications.findBy('user_id', user.id);
    return c.json({
      object: 'list',
      data: apps.map(formatAuthorizedApplication),
      list_metadata: { before: null, after: null },
    });
  });

  app.delete('/user_management/users/:user_id/authorized_applications/:application_id', (c) => {
    const user = ws.users.get(c.req.param('user_id'));
    if (!user) throw notFound('User');

    const appItem = ws.authorizedApplications.get(c.req.param('application_id'));
    if (!appItem || appItem.user_id !== user.id) throw notFound('Authorized Application');

    ws.authorizedApplications.delete(appItem.id);
    return c.body(null, 204);
  });

  app.get('/user_management/users/:user_id/connected_accounts/:slug', (c) => {
    const user = ws.users.get(c.req.param('user_id'));
    if (!user) throw notFound('User');

    const slug = c.req.param('slug');
    const account = ws.connectedAccounts.findBy('user_id', user.id).find((a) => a.provider === slug);

    if (!account) throw notFound('Connected Account');
    return c.json(formatConnectedAccount(account));
  });

  app.get('/user_management/users/:user_id/data_providers', (c) => {
    const user = ws.users.get(c.req.param('user_id'));
    if (!user) throw notFound('User');

    const pipes = ws.pipeConnections.findBy('user_id', user.id);
    return c.json({
      object: 'list',
      data: pipes.map(formatPipeConnection),
      list_metadata: { before: null, after: null },
    });
  });
}
