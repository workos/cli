import { type RouteContext, notFound, parseJsonBody, parseListParams } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatRadarAttempt, formatListResponse } from '../helpers.js';

export function radarRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  // List attempts
  app.get('/radar/attempts', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const result = ws.radarAttempts.list({ ...params });
    return c.json(formatListResponse(result, formatRadarAttempt));
  });

  // Get attempt
  app.get('/radar/attempts/:id', (c) => {
    const attempt = ws.radarAttempts.get(c.req.param('id'));
    if (!attempt) throw notFound('RadarAttempt');
    return c.json(formatRadarAttempt(attempt));
  });

  // Manage allow/deny lists
  app.post('/radar/lists/:type/:action', async (c) => {
    const listType = c.req.param('type');
    const action = c.req.param('action');
    const body = await parseJsonBody(c);
    const entries = (body.entries as string[]) ?? [];

    const key = `radar_${listType}_list`;
    const existing = store.getData<Set<string>>(key) ?? new Set<string>();

    if (action === 'add') {
      for (const entry of entries) existing.add(entry);
    } else if (action === 'remove') {
      for (const entry of entries) existing.delete(entry);
    }

    store.setData(key, existing);
    return c.json({ success: true });
  });
}
