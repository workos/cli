import { type RouteContext, parseListParams } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatEvent, formatListResponse } from '../helpers.js';

export function eventRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);

  app.get('/events', (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);
    const eventTypes = url.searchParams.getAll('events[]');

    const result = ws.events.list({
      ...params,
      filter: eventTypes.length > 0 ? (e) => eventTypes.includes(e.event) : undefined,
    });

    return c.json(formatListResponse(result, formatEvent));
  });
}
