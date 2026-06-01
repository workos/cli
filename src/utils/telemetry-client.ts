import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { debug, isDebugEnabled } from './debug.js';
import type { TelemetryEvent, TelemetryRequest } from './telemetry-types.js';
import { getCredentials, isTokenExpired } from '../lib/credentials.js';

function summarizeEvent(event: TelemetryEvent): string {
  switch (event.type) {
    case 'session.start':
      return `session.start(mode=${event.attributes['installer.mode']}, os=${event.attributes['env.os']})`;
    case 'session.end':
      return `session.end(outcome=${event.attributes['installer.outcome']}, duration=${event.attributes['installer.duration_ms']}ms)`;
    case 'step':
      return `step(${event.name}, ${event.durationMs}ms, success=${event.success})`;
    case 'agent.tool':
      return `agent.tool(${event.toolName}, ${event.durationMs}ms)`;
    case 'agent.llm':
      return `agent.llm(${event.model}, in=${event.inputTokens}, out=${event.outputTokens})`;
    case 'command':
      return `command(${event.attributes['command.name']}, ${event.attributes['command.duration_ms']}ms, success=${event.attributes['command.success']})`;
    case 'crash':
      return `crash(${event.attributes['crash.error_type']}: ${event.attributes['crash.error_message']})`;
  }
}

/**
 * HTTP client that queues telemetry events and flushes them to the API.
 * Failures are silent—telemetry should never crash the wizard.
 */
export class TelemetryClient {
  private events: TelemetryEvent[] = [];
  private flushInFlight: Promise<boolean> | null = null;
  private accessToken: string | null = null;
  private claimToken: string | null = null;
  private clientId: string | null = null;
  private apiKey: string | null = null;
  private gatewayUrl: string | null = null;

  setGatewayUrl(url: string) {
    this.gatewayUrl = url;
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  setApiKeyAuth(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Set claim-token auth for unclaimed environments.
   * The API accepts either a JWT (Bearer), claim token
   * (x-workos-claim-token + x-workos-client-id), or API key
   * (x-workos-api-key).
   */
  setClaimTokenAuth(clientId: string, claimToken: string) {
    this.clientId = clientId;
    this.claimToken = claimToken;
  }

  queueEvent(event: TelemetryEvent) {
    this.events.push(event);
  }

  /**
   * Queue multiple pre-formed events (used by store-forward recovery).
   */
  queueEvents(events: TelemetryEvent[]): void {
    this.events.push(...events);
  }

  /**
   * Flush queued events. Returns true if events were sent or intentionally
   * dropped (4xx), false if they should be retried (5xx/network error).
   * Uses splice to only remove the events that were in the snapshot,
   * protecting any events queued concurrently during the fetch.
   */
  async flush(): Promise<boolean> {
    // Coalesce overlapping flushes: a second caller during an in-flight flush
    // would otherwise snapshot and POST the same events again (duplicate send),
    // and its splice() could drop events queued after the first flush started.
    if (this.flushInFlight) return this.flushInFlight;
    this.flushInFlight = this.flushInternal();
    try {
      return await this.flushInFlight;
    } finally {
      this.flushInFlight = null;
    }
  }

  private async flushInternal(): Promise<boolean> {
    if (this.events.length === 0) return true;
    if (!this.gatewayUrl) {
      debug('[Telemetry] No telemetry URL configured, skipping flush');
      return false;
    }

    const count = this.events.length;
    const payload: TelemetryRequest = { events: this.events.slice(0, count) };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // Read fresh credentials to handle token refresh mid-session. Skip an
    // expired stored token — sending a dead Bearer 401s and the event is
    // dropped, so fall through to claim-token / api-key auth instead.
    const freshCreds = getCredentials();
    const token = freshCreds?.accessToken
      ? isTokenExpired(freshCreds)
        ? null
        : freshCreds.accessToken
      : this.accessToken;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (this.claimToken && this.clientId) {
      // Unclaimed environment auth path — guard accepts this instead of JWT
      headers['x-workos-claim-token'] = this.claimToken;
      headers['x-workos-client-id'] = this.clientId;
    } else if (this.apiKey) {
      headers['x-workos-api-key'] = this.apiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      if (isDebugEnabled()) {
        const eventSummary = payload.events.map(summarizeEvent).join('\n  ');
        debug(
          `[Telemetry] Sending ${payload.events.length} events to ${this.gatewayUrl}/telemetry:\n  ${eventSummary}`,
        );
      }

      const response = await fetch(`${this.gatewayUrl}/telemetry`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok) {
        this.events.splice(0, count);
        return true;
      } else {
        debug(`[Telemetry] Failed to send: ${response.status}`);
        // Drop on 4xx (permanent failures like 401/403 won't succeed on retry).
        // Retain on 5xx (transient server errors) for store-forward.
        if (response.status >= 400 && response.status < 500) {
          this.events.splice(0, count);
          return true; // intentionally dropped
        }
        return false;
      }
    } catch (error) {
      debug(`[Telemetry] Error sending events: ${error}`);
      // Events remain in queue for store-forward to persist
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Synchronously write pending events to a file.
   * Used as last resort in process.on('exit') handler.
   */
  persistToFile(filePath: string): void {
    if (this.events.length === 0) return;
    try {
      // Restrictive modes — the payload carries device/user identifiers.
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
      writeFileSync(filePath, JSON.stringify(this.events), { encoding: 'utf-8', mode: 0o600 });
      this.events = [];
    } catch {
      // Silent failure — telemetry must never block exit
    }
  }
}

export const telemetryClient = new TelemetryClient();
