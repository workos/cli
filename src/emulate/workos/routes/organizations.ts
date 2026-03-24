import { type RouteContext, notFound, validationError, parseJsonBody } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatOrganization, generateVerificationToken, parseListParams } from '../helpers.js';

export function organizationRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.post('/organizations', async (c) => {
    const body = await parseJsonBody(c);
    const name = body.name as string | undefined;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw validationError('Name is required', [{ field: 'name', code: 'required' }]);
    }

    const org = ws.organizations.insert({
      object: 'organization',
      name: name.trim(),
      external_id: (body.external_id as string) ?? null,
      metadata: (body.metadata as Record<string, string>) ?? {},
      stripe_customer_id: null,
    });

    const domainData = body.domain_data as Array<{ domain: string; state?: string }> | undefined;
    if (domainData && Array.isArray(domainData)) {
      for (const dd of domainData) {
        ws.organizationDomains.insert({
          object: 'organization_domain',
          organization_id: org.id,
          domain: dd.domain,
          state: dd.state === 'verified' ? 'verified' : 'pending',
          verification_strategy: 'manual',
          verification_token: generateVerificationToken(),
          verification_prefix: 'workos-verify',
        });
      }
    }

    return c.json(formatOrganization(org, ws), 201);
  });

  app.get('/organizations', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const nameFilter = url.searchParams.get('name') ?? undefined;
    const domainsFilter = url.searchParams.get('domains') ?? undefined;

    const result = ws.organizations.list({
      ...params,
      filter: (org) => {
        if (nameFilter && !org.name.toLowerCase().includes(nameFilter.toLowerCase())) {
          return false;
        }
        if (domainsFilter) {
          const orgDomains = ws.organizationDomains.findBy('organization_id', org.id);
          if (!orgDomains.some((d) => d.domain === domainsFilter)) {
            return false;
          }
        }
        return true;
      },
    });

    return c.json({
      object: 'list',
      data: result.data.map((org) => formatOrganization(org, ws)),
      list_metadata: result.list_metadata,
    });
  });

  app.get('/organizations/:id', (c) => {
    const org = ws.organizations.get(c.req.param('id'));
    if (!org) throw notFound('Organization');
    return c.json(formatOrganization(org, ws));
  });

  app.get('/organizations/external_id/:external_id', (c) => {
    const org = ws.organizations.findOneBy('external_id', c.req.param('external_id'));
    if (!org) throw notFound('Organization');
    return c.json(formatOrganization(org, ws));
  });

  app.put('/organizations/:id', async (c) => {
    const org = ws.organizations.get(c.req.param('id'));
    if (!org) throw notFound('Organization');

    const body = await parseJsonBody(c);
    const updates: Record<string, unknown> = {};

    if ('name' in body) {
      if (!body.name || typeof body.name !== 'string' || (body.name as string).trim().length === 0) {
        throw validationError('Name is required', [{ field: 'name', code: 'required' }]);
      }
      updates.name = (body.name as string).trim();
    }
    if ('external_id' in body) updates.external_id = body.external_id ?? null;
    if ('metadata' in body) updates.metadata = body.metadata ?? {};

    if ('domain_data' in body && Array.isArray(body.domain_data)) {
      const existing = ws.organizationDomains.findBy('organization_id', org.id);
      const incoming = body.domain_data as Array<{ domain: string; state?: string }>;
      const incomingDomains = new Set(incoming.map((d) => d.domain));

      for (const d of existing) {
        if (!incomingDomains.has(d.domain)) {
          ws.organizationDomains.delete(d.id);
        }
      }

      const existingDomains = new Set(existing.map((d) => d.domain));
      for (const dd of incoming) {
        if (!existingDomains.has(dd.domain)) {
          ws.organizationDomains.insert({
            object: 'organization_domain',
            organization_id: org.id,
            domain: dd.domain,
            state: dd.state === 'verified' ? 'verified' : 'pending',
            verification_strategy: 'manual',
            verification_token: generateVerificationToken(),
            verification_prefix: 'workos-verify',
          });
        }
      }
    }

    const updated = ws.organizations.update(org.id, updates);
    return c.json(formatOrganization(updated!, ws));
  });

  app.delete('/organizations/:id', (c) => {
    const org = ws.organizations.get(c.req.param('id'));
    if (!org) throw notFound('Organization');

    const domains = ws.organizationDomains.findBy('organization_id', org.id);
    for (const d of domains) {
      ws.organizationDomains.delete(d.id);
    }

    const memberships = ws.organizationMemberships.findBy('organization_id', org.id);
    for (const m of memberships) {
      ws.organizationMemberships.delete(m.id);
    }

    ws.organizations.delete(org.id);
    return c.body(null, 204);
  });
}
