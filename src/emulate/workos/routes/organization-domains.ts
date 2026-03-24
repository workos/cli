import { type RouteContext, notFound, validationError, parseJsonBody, WorkOSApiError } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatDomain, generateVerificationToken } from '../helpers.js';

export function organizationDomainRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.post('/organization_domains', async (c) => {
    const body = await parseJsonBody(c);
    const organizationId = body.organization_id as string | undefined;
    const domain = body.domain as string | undefined;

    if (!organizationId) {
      throw validationError('organization_id is required', [{ field: 'organization_id', code: 'required' }]);
    }
    if (!domain) {
      throw validationError('domain is required', [{ field: 'domain', code: 'required' }]);
    }

    const org = ws.organizations.get(organizationId);
    if (!org) throw notFound('Organization');

    const existing = ws.organizationDomains.findBy('organization_id', organizationId).find((d) => d.domain === domain);
    if (existing) {
      throw new WorkOSApiError(409, 'Domain already exists for this organization', 'conflict');
    }

    const domainEntity = ws.organizationDomains.insert({
      object: 'organization_domain',
      organization_id: organizationId,
      domain,
      state: 'pending',
      verification_strategy: (body.verification_strategy as 'manual' | 'dns') ?? 'manual',
      verification_token: generateVerificationToken(),
      verification_prefix: 'workos-verify',
    });

    return c.json(formatDomain(domainEntity), 201);
  });

  app.get('/organization_domains/:id', (c) => {
    const domain = ws.organizationDomains.get(c.req.param('id'));
    if (!domain) throw notFound('Organization Domain');
    return c.json(formatDomain(domain));
  });

  app.delete('/organization_domains/:id', (c) => {
    const domain = ws.organizationDomains.get(c.req.param('id'));
    if (!domain) throw notFound('Organization Domain');
    ws.organizationDomains.delete(domain.id);
    return c.body(null, 204);
  });

  app.post('/organization_domains/:id/verify', (c) => {
    const domain = ws.organizationDomains.get(c.req.param('id'));
    if (!domain) throw notFound('Organization Domain');

    const updated = ws.organizationDomains.update(domain.id, {
      state: 'verified',
    });
    return c.json(formatDomain(updated!));
  });
}
