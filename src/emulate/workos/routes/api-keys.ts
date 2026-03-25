import { type RouteContext, notFound, parseJsonBody } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatApiKeyRecord, parseListParams } from '../helpers.js';
import type { ApiKeyMap } from '../../core/index.js';

export function apiKeyRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  // Validate an API key
  app.post('/api_keys/validations', async (c) => {
    const body = await parseJsonBody(c);
    const key = body.key as string | undefined;
    const apiKeyMap = store.getData<ApiKeyMap>('apiKeyMap') ?? {};
    const valid = !!key && key in apiKeyMap;
    return c.json({ valid });
  });

  // Delete an API key record
  app.delete('/api_keys/:id', (c) => {
    const record = ws.apiKeyRecords.get(c.req.param('id'));
    if (!record) throw notFound('ApiKey');
    ws.apiKeyRecords.delete(record.id);
    return c.body(null, 204);
  });

  // List API keys for an organization
  app.get('/organizations/:orgId/api_keys', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const result = ws.apiKeyRecords.list({ ...params });
    return c.json({
      object: 'list',
      data: result.data.map(formatApiKeyRecord),
      list_metadata: result.list_metadata,
    });
  });
}
