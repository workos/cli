import { debug } from './debug.js';
import type { TelemetryEvent, TelemetryRequest } from './telemetry-types.js';

/**
 * HTTP client that queues telemetry events and flushes them to the gateway.
 * Failures are silent—telemetry should never crash the wizard.
 */
export class TelemetryClient {
  private events: TelemetryEvent[] = [];
  private accessToken: string | null = null;
  private gatewayUrl: string | null = null;

  setGatewayUrl(url: string) {
    this.gatewayUrl = url;
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  queueEvent(event: TelemetryEvent) {
    this.events.push(event);
  }

  async flush(): Promise<void> {
    if (this.events.length === 0) return;
    if (!this.gatewayUrl) {
      debug('[Telemetry] No gateway URL configured, skipping flush');
      return;
    }

    const payload: TelemetryRequest = { events: [...this.events] };
    this.events = []; // Clear immediately

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    try {
      debug(`[Telemetry] Sending ${payload.events.length} events to ${this.gatewayUrl}/telemetry`);

      const response = await fetch(`${this.gatewayUrl}/telemetry`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        debug(`[Telemetry] Failed to send: ${response.status}`);
      }
    } catch (error) {
      debug(`[Telemetry] Error sending events: ${error}`);
      // Silent failure - don't crash wizard
    }
  }
}

export const telemetryClient = new TelemetryClient();
