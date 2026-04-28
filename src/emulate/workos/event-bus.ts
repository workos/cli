import type { Store } from '../core/index.js';
import { getWorkOSStore } from './store.js';
import type { WorkOSWebhookEndpoint, WorkOSEvent } from './entities.js';
import { signWebhookPayload } from './webhook-signer.js';
import type { WorkOSEventName } from './constants.js';

export interface EventPayload {
  event: WorkOSEventName | string;
  data: Record<string, unknown>;
  environment_id?: string;
}

export class EventBus {
  private endpointsByEvent = new Map<string, Set<string>>();
  private catchAllEndpoints = new Set<string>();

  constructor(private store: Store) {}

  /** Rebuild the event-type index.  Auto-called via collection hooks; call manually only in tests. */
  rebuildIndex(): void {
    this.endpointsByEvent.clear();
    this.catchAllEndpoints.clear();
    const ws = getWorkOSStore(this.store);
    for (const ep of ws.webhookEndpoints.all()) {
      if (!ep.enabled) continue;
      if (ep.events.length === 0) {
        this.catchAllEndpoints.add(ep.id);
      } else {
        for (const evt of ep.events) {
          const set = this.endpointsByEvent.get(evt) ?? new Set();
          set.add(ep.id);
          this.endpointsByEvent.set(evt, set);
        }
      }
    }
  }

  emit(payload: EventPayload): void {
    const ws = getWorkOSStore(this.store);

    const event = ws.events.insert({
      object: 'event',
      event: payload.event,
      data: payload.data,
      environment_id: payload.environment_id ?? null,
    });

    // Pre-filtered: only endpoints that care about this event
    const targetIds = new Set(this.catchAllEndpoints);
    const eventSpecific = this.endpointsByEvent.get(payload.event);
    if (eventSpecific) {
      for (const id of eventSpecific) targetIds.add(id);
    }

    for (const id of targetIds) {
      const endpoint = ws.webhookEndpoints.get(id);
      if (endpoint) this.deliver(endpoint, event).catch(() => {});
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

    await fetch(endpoint.endpoint_url, {
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
