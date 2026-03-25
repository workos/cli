import { type RouteContext, notFound, validationError, parseJsonBody } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatAuthorizationResource, formatMembership, parseListParams } from '../helpers.js';

export function authorizationResourceRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;

  app.post('/authorization/resources', async (c) => {
    const ws = getWorkOSStore(store);
    const body = await parseJsonBody(c);

    const resourceTypeSlug = body.resource_type_slug as string;
    const externalId = body.external_id as string;
    const organizationId = body.organization_id as string;

    if (!resourceTypeSlug) {
      throw validationError('resource_type_slug is required', [{ field: 'resource_type_slug', code: 'required' }]);
    }
    if (!externalId) {
      throw validationError('external_id is required', [{ field: 'external_id', code: 'required' }]);
    }
    if (!organizationId) {
      throw validationError('organization_id is required', [{ field: 'organization_id', code: 'required' }]);
    }

    const resource = ws.authorizationResources.insert({
      object: 'authorization_resource',
      resource_type_slug: resourceTypeSlug,
      external_id: externalId,
      organization_id: organizationId,
      metadata: (body.metadata as Record<string, string>) ?? {},
    });

    return c.json(formatAuthorizationResource(resource), 201);
  });

  app.get('/authorization/resources', (c) => {
    const ws = getWorkOSStore(store);
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const organizationId = url.searchParams.get('organization_id') ?? undefined;
    const resourceTypeSlug = url.searchParams.get('resource_type_slug') ?? undefined;

    const result = ws.authorizationResources.list({
      ...params,
      filter: (r) => {
        if (organizationId && r.organization_id !== organizationId) return false;
        if (resourceTypeSlug && r.resource_type_slug !== resourceTypeSlug) return false;
        return true;
      },
    });

    return c.json({
      object: 'list',
      data: result.data.map(formatAuthorizationResource),
      list_metadata: result.list_metadata,
    });
  });

  app.get('/authorization/resources/:resource_id', (c) => {
    const ws = getWorkOSStore(store);
    const resourceId = c.req.param('resource_id');
    const resource = ws.authorizationResources.get(resourceId);
    if (!resource) throw notFound('AuthorizationResource');
    return c.json(formatAuthorizationResource(resource));
  });

  app.put('/authorization/resources/:resource_id', async (c) => {
    const ws = getWorkOSStore(store);
    const resourceId = c.req.param('resource_id');
    const resource = ws.authorizationResources.get(resourceId);
    if (!resource) throw notFound('AuthorizationResource');

    const body = await parseJsonBody(c);
    const updates: Record<string, unknown> = {};
    if ('metadata' in body) updates.metadata = body.metadata;

    const updated = ws.authorizationResources.update(resourceId, updates);
    return c.json(formatAuthorizationResource(updated!));
  });

  app.delete('/authorization/resources/:resource_id', (c) => {
    const ws = getWorkOSStore(store);
    const resourceId = c.req.param('resource_id');
    const resource = ws.authorizationResources.get(resourceId);
    if (!resource) throw notFound('AuthorizationResource');

    ws.authorizationResources.delete(resourceId);
    return c.body(null, 204);
  });

  // Memberships with access to a resource (by resource ID)
  app.get('/authorization/resources/:resource_id/organization_memberships', (c) => {
    const ws = getWorkOSStore(store);
    const resourceId = c.req.param('resource_id');
    const resource = ws.authorizationResources.get(resourceId);
    if (!resource) throw notFound('AuthorizationResource');

    const memberships = ws.organizationMemberships.findBy('organization_id', resource.organization_id);
    return c.json({
      object: 'list',
      data: memberships.map(formatMembership),
      list_metadata: { before: null, after: null },
    });
  });

  // Get resource by type + external ID within an org
  app.get('/authorization/organizations/:orgId/resources/:type_slug/:external_id', (c) => {
    const ws = getWorkOSStore(store);
    const orgId = c.req.param('orgId');
    const typeSlug = c.req.param('type_slug');
    const externalId = c.req.param('external_id');

    const resource = ws.authorizationResources
      .findBy('organization_id', orgId)
      .find((r) => r.resource_type_slug === typeSlug && r.external_id === externalId);
    if (!resource) throw notFound('AuthorizationResource');
    return c.json(formatAuthorizationResource(resource));
  });

  // Memberships for resource by type + external ID within an org
  app.get('/authorization/organizations/:orgId/resources/:type_slug/:external_id/organization_memberships', (c) => {
    const ws = getWorkOSStore(store);
    const orgId = c.req.param('orgId');
    const typeSlug = c.req.param('type_slug');
    const externalId = c.req.param('external_id');

    const resource = ws.authorizationResources
      .findBy('organization_id', orgId)
      .find((r) => r.resource_type_slug === typeSlug && r.external_id === externalId);
    if (!resource) throw notFound('AuthorizationResource');

    const memberships = ws.organizationMemberships.findBy('organization_id', resource.organization_id);
    return c.json({
      object: 'list',
      data: memberships.map(formatMembership),
      list_metadata: { before: null, after: null },
    });
  });
}
