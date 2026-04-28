import { randomBytes } from 'node:crypto';
import { type RouteContext, notFound, validationError, parseJsonBody, parseListParams } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatWebhookEndpoint, formatListResponse } from '../helpers.js';

export function webhookEndpointRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.post('/webhook_endpoints', async (c) => {
    const body = await parseJsonBody(c);
    const endpointUrl = (body.endpoint_url ?? body.url) as string | undefined;
    if (!endpointUrl || typeof endpointUrl !== 'string') {
      throw validationError('endpoint_url is required', [{ field: 'endpoint_url', code: 'required' }]);
    }

    const secret = (body.secret as string) ?? randomBytes(32).toString('hex');

    const endpoint = ws.webhookEndpoints.insert({
      object: 'webhook_endpoint',
      endpoint_url: endpointUrl,
      secret,
      enabled: body.enabled !== false,
      events: Array.isArray(body.events) ? (body.events as string[]) : [],
      description: (body.description as string) ?? null,
    });

    return c.json(formatWebhookEndpoint(endpoint, { includeSecret: true }), 201);
  });

  app.get('/webhook_endpoints', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);

    const result = ws.webhookEndpoints.list(params);
    return c.json(formatListResponse(result, (ep) => formatWebhookEndpoint(ep)));
  });

  app.get('/webhook_endpoints/:id', (c) => {
    const ep = ws.webhookEndpoints.get(c.req.param('id'));
    if (!ep) throw notFound('WebhookEndpoint');
    return c.json(formatWebhookEndpoint(ep));
  });

  app.put('/webhook_endpoints/:id', async (c) => {
    const ep = ws.webhookEndpoints.get(c.req.param('id'));
    if (!ep) throw notFound('WebhookEndpoint');

    const body = await parseJsonBody(c);
    const updates: Record<string, unknown> = {};

    if ('endpoint_url' in body || 'url' in body) {
      const newUrl = (body.endpoint_url ?? body.url) as string | undefined;
      if (!newUrl || typeof newUrl !== 'string') {
        throw validationError('endpoint_url is required', [{ field: 'endpoint_url', code: 'required' }]);
      }
      updates.endpoint_url = newUrl;
    }
    if ('enabled' in body) updates.enabled = !!body.enabled;
    if ('events' in body) updates.events = Array.isArray(body.events) ? body.events : [];
    if ('description' in body) updates.description = body.description ?? null;

    const updated = ws.webhookEndpoints.update(ep.id, updates);
    return c.json(formatWebhookEndpoint(updated!));
  });

  app.delete('/webhook_endpoints/:id', (c) => {
    const ep = ws.webhookEndpoints.get(c.req.param('id'));
    if (!ep) throw notFound('WebhookEndpoint');
    ws.webhookEndpoints.delete(ep.id);
    return c.body(null, 204);
  });
}
