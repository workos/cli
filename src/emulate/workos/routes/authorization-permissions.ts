import { type RouteContext, notFound, validationError, parseJsonBody } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatPermission, parseListParams } from '../helpers.js';

export function authorizationPermissionRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;

  app.post('/authorization/permissions', async (c) => {
    const ws = getWorkOSStore(store);
    const body = await parseJsonBody(c);
    const slug = body.slug as string;
    const name = body.name as string;

    if (!slug || typeof slug !== 'string') {
      throw validationError('slug is required', [{ field: 'slug', code: 'required' }]);
    }
    if (!name || typeof name !== 'string') {
      throw validationError('name is required', [{ field: 'name', code: 'required' }]);
    }

    const existing = ws.permissions.findOneBy('slug', slug);
    if (existing) {
      throw validationError('Permission with this slug already exists', [{ field: 'slug', code: 'duplicate' }]);
    }

    const permission = ws.permissions.insert({
      object: 'permission',
      slug,
      name,
      description: (body.description as string) ?? null,
    });

    return c.json(formatPermission(permission), 201);
  });

  app.get('/authorization/permissions', (c) => {
    const ws = getWorkOSStore(store);
    const url = new URL(c.req.url);
    const params = parseListParams(url);

    const result = ws.permissions.list(params);
    return c.json({
      object: 'list',
      data: result.data.map(formatPermission),
      list_metadata: result.list_metadata,
    });
  });

  app.get('/authorization/permissions/:slug', (c) => {
    const ws = getWorkOSStore(store);
    const slug = c.req.param('slug');
    const permission = ws.permissions.findOneBy('slug', slug);
    if (!permission) throw notFound('Permission');
    return c.json(formatPermission(permission));
  });

  app.put('/authorization/permissions/:slug', async (c) => {
    const ws = getWorkOSStore(store);
    const slug = c.req.param('slug');
    const permission = ws.permissions.findOneBy('slug', slug);
    if (!permission) throw notFound('Permission');

    const body = await parseJsonBody(c);
    const updates: Record<string, unknown> = {};
    if ('name' in body) updates.name = body.name;
    if ('description' in body) updates.description = body.description ?? null;

    const updated = ws.permissions.update(permission.id, updates);
    return c.json(formatPermission(updated!));
  });

  app.delete('/authorization/permissions/:slug', (c) => {
    const ws = getWorkOSStore(store);
    const slug = c.req.param('slug');
    const permission = ws.permissions.findOneBy('slug', slug);
    if (!permission) throw notFound('Permission');

    // Cascade: remove from all role-permission joins
    const rps = ws.rolePermissions.findBy('permission_id', permission.id);
    for (const rp of rps) {
      ws.rolePermissions.delete(rp.id);
    }

    ws.permissions.delete(permission.id);
    return c.body(null, 204);
  });
}
