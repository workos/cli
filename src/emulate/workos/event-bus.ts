import type { Store } from '../core/index.js';
import { getWorkOSStore } from './store.js';
import type { WorkOSWebhookEndpoint, WorkOSEvent } from './entities.js';
import { signWebhookPayload } from './webhook-signer.js';

export interface EventPayload {
  event: string;
  data: Record<string, unknown>;
  environment_id?: string;
}

export class EventBus {
  constructor(private store: Store) {}

  emit(payload: EventPayload): void {
    const ws = getWorkOSStore(this.store);

    const event = ws.events.insert({
      object: 'event',
      event: payload.event,
      data: payload.data,
      environment_id: payload.environment_id ?? null,
    });

    const endpoints = ws.webhookEndpoints.all();
    for (const endpoint of endpoints) {
      if (!endpoint.enabled) continue;
      if (endpoint.events.length > 0 && !endpoint.events.includes(payload.event)) continue;
      // Fire-and-forget — don't await
      this.deliver(endpoint, event).catch(() => {});
    }
  }

  private async deliver(endpoint: WorkOSWebhookEndpoint, event: WorkOSEvent): Promise<void> {
    const body = JSON.stringify({
      id: event.id,
      event: event.event,
      data: event.data,
      created_at: event.created_at,
    });

    const signature = signWebhookPayload(body, endpoint.secret);

    await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'WorkOS-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
  }
}
