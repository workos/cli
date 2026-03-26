import { type RouteContext, notFound, parseListParams } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatDirectory, formatDirectoryUser, formatDirectoryGroup, formatListResponse } from '../helpers.js';

export function directoryRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  // List directories
  app.get('/directories', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const orgFilter = url.searchParams.get('organization_id') ?? undefined;
    const search = url.searchParams.get('search') ?? undefined;

    const result = ws.directories.list({
      ...params,
      filter: (d) => {
        if (orgFilter && d.organization_id !== orgFilter) return false;
        if (search && !d.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      },
    });

    return c.json(formatListResponse(result, formatDirectory));
  });

  // Get directory
  app.get('/directories/:id', (c) => {
    const dir = ws.directories.get(c.req.param('id'));
    if (!dir) throw notFound('Directory');
    return c.json(formatDirectory(dir));
  });

  // Delete directory (cascade users + groups)
  app.delete('/directories/:id', (c) => {
    const dir = ws.directories.get(c.req.param('id'));
    if (!dir) throw notFound('Directory');

    ws.directoryUsers.deleteBy('directory_id', dir.id);
    ws.directoryGroups.deleteBy('directory_id', dir.id);

    ws.directories.delete(dir.id);
    return c.body(null, 204);
  });

  // List directory users
  app.get('/directory_users', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const directoryId = url.searchParams.get('directory_id') ?? undefined;
    const groupId = url.searchParams.get('group_id') ?? undefined;

    const result = ws.directoryUsers.list({
      ...params,
      filter: (u) => {
        if (directoryId && u.directory_id !== directoryId) return false;
        if (groupId && !u.groups.some((g) => g.id === groupId)) return false;
        return true;
      },
    });

    return c.json(formatListResponse(result, formatDirectoryUser));
  });

  // Get directory user
  app.get('/directory_users/:id', (c) => {
    const user = ws.directoryUsers.get(c.req.param('id'));
    if (!user) throw notFound('DirectoryUser');
    return c.json(formatDirectoryUser(user));
  });

  // List directory groups
  app.get('/directory_groups', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const directoryId = url.searchParams.get('directory_id') ?? undefined;

    const result = ws.directoryGroups.list({
      ...params,
      filter: (g) => {
        if (directoryId && g.directory_id !== directoryId) return false;
        return true;
      },
    });

    return c.json(formatListResponse(result, formatDirectoryGroup));
  });

  // Get directory group
  app.get('/directory_groups/:id', (c) => {
    const group = ws.directoryGroups.get(c.req.param('id'));
    if (!group) throw notFound('DirectoryGroup');
    return c.json(formatDirectoryGroup(group));
  });
}
