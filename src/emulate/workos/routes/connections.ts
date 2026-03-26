import { type RouteContext, notFound, parseJsonBody, generateId, parseListParams } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatConnection, formatListResponse } from '../helpers.js';
import type { WorkOSConnectionType } from '../entities.js';

export function connectionRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.post('/connections', async (c) => {
    const body = await parseJsonBody(c);
    const name = body.name as string;
    const organizationId = body.organization_id as string;
    const connectionType = (body.connection_type as WorkOSConnectionType) ?? 'GenericSAML';
    const domainsList = (body.domains as string[]) ?? [];

    if (!organizationId) {
      throw notFound('Organization');
    }
    const org = ws.organizations.get(organizationId);
    if (!org) throw notFound('Organization');

    const domains = domainsList.map((d) => ({
      object: 'connection_domain' as const,
      id: generateId('conn_domain'),
      domain: d,
    }));

    const conn = ws.connections.insert({
      object: 'connection',
      organization_id: organizationId,
      connection_type: connectionType,
      name: name ?? `${org.name} SSO`,
      state: 'active',
      domains,
    });

    return c.json(formatConnection(conn), 201);
  });

  app.get('/connections', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const orgFilter = url.searchParams.get('organization_id') ?? undefined;
    const typeFilter = url.searchParams.get('connection_type') ?? undefined;
    const domainFilter = url.searchParams.get('domain') ?? undefined;

    const result = ws.connections.list({
      ...params,
      filter: (conn) => {
        if (orgFilter && conn.organization_id !== orgFilter) return false;
        if (typeFilter && conn.connection_type !== typeFilter) return false;
        if (domainFilter && !conn.domains.some((d) => d.domain === domainFilter)) return false;
        return true;
      },
    });

    return c.json(formatListResponse(result, formatConnection));
  });

  app.get('/connections/:id', (c) => {
    const conn = ws.connections.get(c.req.param('id'));
    if (!conn) throw notFound('Connection');
    return c.json(formatConnection(conn));
  });

  app.delete('/connections/:id', (c) => {
    const conn = ws.connections.get(c.req.param('id'));
    if (!conn) throw notFound('Connection');

    for (const auth of ws.ssoAuthorizations.all()) {
      if (auth.connection_id === conn.id) {
        ws.ssoAuthorizations.delete(auth.id);
      }
    }

    ws.connections.delete(conn.id);
    return c.body(null, 204);
  });
}
