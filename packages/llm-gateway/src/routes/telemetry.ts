import { Hono } from 'hono';
import { validateJWT } from '../jwt.js';
import { processEvent } from '../telemetry/converter.js';
import type { TelemetryRequest } from '../telemetry/types.js';
import { env } from '../env.js';

const telemetry = new Hono();

// Check if local development mode is enabled
const isLocalMode = env.LOCAL_MODE === 'true' || env.LOCAL_MODE === '1';

telemetry.post('/', async (c) => {
  // Auth check (same logic as /v1/messages)
  const authHeader = c.req.header('authorization');
  const hasToken = authHeader && authHeader.startsWith('Bearer ') && authHeader.length > 7;

  if (hasToken) {
    const token = authHeader.replace('Bearer ', '');
    const validation = await validateJWT(token);

    if (!validation.valid) {
      return c.json({ error: validation.error }, 401);
    }
  } else if (!isLocalMode) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  // Parse and validate body
  let body: TelemetryRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.events || !Array.isArray(body.events)) {
    return c.json({ error: 'Missing events array' }, 400);
  }

  // Process events (non-blocking)
  for (const event of body.events) {
    try {
      // Log events in local mode for debugging
      if (isLocalMode) {
        console.log('[Telemetry] Received:', event.type, event.sessionId?.slice(0, 8));
      }
      processEvent(event);
    } catch (err) {
      console.error('[Telemetry] Error processing event:', err);
      // Continue processing other events
    }
  }

  // Return immediately
  return c.json({ received: body.events.length }, 202);
});

export { telemetry };
