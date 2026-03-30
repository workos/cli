import {
  type RouteContext,
  notFound,
  validationError,
  parseJsonBody,
  WorkOSApiError,
  parseListParams,
} from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatMembership, formatListResponse } from '../helpers.js';

export function membershipRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.post('/user_management/organization_memberships', async (c) => {
    const body = await parseJsonBody(c);
    const organizationId = body.organization_id as string | undefined;
    const userId = body.user_id as string | undefined;

    if (!organizationId) {
      throw validationError('organization_id is required', [{ field: 'organization_id', code: 'required' }]);
    }
    if (!userId) {
      throw validationError('user_id is required', [{ field: 'user_id', code: 'required' }]);
    }

    const org = ws.organizations.get(organizationId);
    if (!org) throw notFound('Organization');

    const existing = ws.organizationMemberships
      .findBy('organization_id', organizationId)
      .find((m) => m.user_id === userId && m.status !== 'inactive');
    if (existing) {
      throw new WorkOSApiError(409, 'Membership already exists', 'conflict');
    }

    const roleSlug = (body.role_slug as string) ?? 'member';

    const membership = ws.organizationMemberships.insert({
      object: 'organization_membership',
      organization_id: organizationId,
      user_id: userId,
      role: { slug: roleSlug },
      status: 'active',
      external_id: (body.external_id as string) ?? null,
      metadata: (body.metadata as Record<string, string>) ?? {},
    });

    return c.json(formatMembership(membership), 201);
  });

  app.get('/user_management/organization_memberships', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const orgFilter = url.searchParams.get('organization_id') ?? undefined;
    const userFilter = url.searchParams.get('user_id') ?? undefined;
    const statusesParam = url.searchParams.getAll('statuses[]');

    const result = ws.organizationMemberships.list({
      ...params,
      filter: (m) => {
        if (orgFilter && m.organization_id !== orgFilter) return false;
        if (userFilter && m.user_id !== userFilter) return false;
        if (statusesParam.length > 0 && !statusesParam.includes(m.status)) return false;
        return true;
      },
    });

    return c.json(formatListResponse(result, formatMembership));
  });

  app.get('/user_management/organization_memberships/:id', (c) => {
    const m = ws.organizationMemberships.get(c.req.param('id'));
    if (!m) throw notFound('Organization Membership');
    return c.json(formatMembership(m));
  });

  app.put('/user_management/organization_memberships/:id', async (c) => {
    const m = ws.organizationMemberships.get(c.req.param('id'));
    if (!m) throw notFound('Organization Membership');

    const body = await parseJsonBody(c);
    const updates: Record<string, unknown> = {};

    if ('role_slug' in body) {
      updates.role = { slug: body.role_slug as string };
    }
    if ('external_id' in body) {
      updates.external_id = body.external_id ?? null;
    }
    if ('metadata' in body) {
      updates.metadata = body.metadata ?? {};
    }

    const updated = ws.organizationMemberships.update(m.id, updates);
    return c.json(formatMembership(updated!));
  });

  app.delete('/user_management/organization_memberships/:id', (c) => {
    const m = ws.organizationMemberships.get(c.req.param('id'));
    if (!m) throw notFound('Organization Membership');
    ws.organizationMemberships.delete(m.id);
    return c.body(null, 204);
  });

  app.put('/user_management/organization_memberships/:id/deactivate', (c) => {
    const m = ws.organizationMemberships.get(c.req.param('id'));
    if (!m) throw notFound('Organization Membership');
    if (m.status === 'inactive') {
      throw validationError('Membership is already inactive');
    }
    const updated = ws.organizationMemberships.update(m.id, {
      status: 'inactive',
    });
    return c.json(formatMembership(updated!));
  });

  app.put('/user_management/organization_memberships/:id/reactivate', (c) => {
    const m = ws.organizationMemberships.get(c.req.param('id'));
    if (!m) throw notFound('Organization Membership');
    if (m.status === 'active') {
      throw validationError('Membership is already active');
    }
    const updated = ws.organizationMemberships.update(m.id, {
      status: 'active',
    });
    return c.json(formatMembership(updated!));
  });
}
