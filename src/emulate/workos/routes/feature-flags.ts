import { type RouteContext, notFound, parseJsonBody, parseListParams } from '../../core/index.js';
import { getWorkOSStore, type WorkOSStore } from '../store.js';
import { formatFeatureFlag, formatFlagTarget, formatListResponse } from '../helpers.js';

function evaluateFlags(ws: WorkOSStore, resourceId: string) {
  const flags = ws.featureFlags.all();
  return flags.map((flag) => {
    const target = ws.flagTargets.findBy('flag_slug', flag.slug).find((t) => t.resource_id === resourceId);
    return {
      slug: flag.slug,
      type: flag.type,
      value: target ? target.value : flag.enabled ? flag.default_value : null,
      enabled: flag.enabled,
    };
  });
}

export function featureFlagRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  // List all flags
  app.get('/feature-flags', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const result = ws.featureFlags.list({ ...params });
    return c.json(formatListResponse(result, formatFeatureFlag));
  });

  // Get flag by slug
  app.get('/feature-flags/:slug', (c) => {
    const flag = ws.featureFlags.findOneBy('slug', c.req.param('slug'));
    if (!flag) throw notFound('FeatureFlag');
    return c.json(formatFeatureFlag(flag));
  });

  // Enable flag
  app.post('/feature-flags/:slug/enable', (c) => {
    const flag = ws.featureFlags.findOneBy('slug', c.req.param('slug'));
    if (!flag) throw notFound('FeatureFlag');
    const updated = ws.featureFlags.update(flag.id, { enabled: true });
    return c.json(formatFeatureFlag(updated!));
  });

  // Disable flag
  app.post('/feature-flags/:slug/disable', (c) => {
    const flag = ws.featureFlags.findOneBy('slug', c.req.param('slug'));
    if (!flag) throw notFound('FeatureFlag');
    const updated = ws.featureFlags.update(flag.id, { enabled: false });
    return c.json(formatFeatureFlag(updated!));
  });

  // Add/update target
  app.put('/feature-flags/:slug/targets/:resourceId', async (c) => {
    const flag = ws.featureFlags.findOneBy('slug', c.req.param('slug'));
    if (!flag) throw notFound('FeatureFlag');

    const resourceId = c.req.param('resourceId');
    const body = await parseJsonBody(c);

    // Upsert: find existing target or create
    const existing = ws.flagTargets.findBy('flag_slug', flag.slug).find((t) => t.resource_id === resourceId);

    if (existing) {
      const updated = ws.flagTargets.update(existing.id, {
        value: body.value,
        resource_type: (body.resource_type as string) ?? existing.resource_type,
      });
      return c.json(formatFlagTarget(updated!));
    }

    const target = ws.flagTargets.insert({
      object: 'flag_target',
      flag_slug: flag.slug,
      resource_id: resourceId,
      resource_type: (body.resource_type as string) ?? 'user',
      value: body.value,
    });

    return c.json(formatFlagTarget(target), 201);
  });

  // Remove target
  app.delete('/feature-flags/:slug/targets/:resourceId', (c) => {
    const flag = ws.featureFlags.findOneBy('slug', c.req.param('slug'));
    if (!flag) throw notFound('FeatureFlag');

    const resourceId = c.req.param('resourceId');
    const target = ws.flagTargets.findBy('flag_slug', flag.slug).find((t) => t.resource_id === resourceId);
    if (!target) throw notFound('FlagTarget');

    ws.flagTargets.delete(target.id);
    return c.body(null, 204);
  });

  // Evaluate flags for organization
  app.get('/organizations/:orgId/feature-flags', (c) => {
    return c.json({
      object: 'list',
      data: evaluateFlags(ws, c.req.param('orgId')),
      list_metadata: { before: null, after: null },
    });
  });

  // Evaluate flags for user
  app.get('/user_management/users/:userId/feature-flags', (c) => {
    return c.json({
      object: 'list',
      data: evaluateFlags(ws, c.req.param('userId')),
      list_metadata: { before: null, after: null },
    });
  });
}
