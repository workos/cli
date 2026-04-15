import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { debug } from './debug.js';
import type { TelemetryEvent, TelemetryRequest } from './telemetry-types.js';
import { getCredentials } from '../lib/credentials.js';

/**
 * HTTP client that queues telemetry events and flushes them to the gateway.
 * Failures are silent—telemetry should never crash the wizard.
 */
export class TelemetryClient {
  private events: TelemetryEvent[] = [];
  private accessToken: string | null = null;
  private claimToken: string | null = null;
  private clientId: string | null = null;
  private gatewayUrl: string | null = null;

  setGatewayUrl(url: string) {
    this.gatewayUrl = url;
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  /**
   * Set claim-token auth for unclaimed environments.
   * The API's LlmGatewayGuard accepts either a JWT (Bearer) or claim token
   * (x-workos-claim-token + x-workos-client-id headers).
   */
  setClaimTokenAuth(clientId: string, claimToken: string) {
    this.clientId = clientId;
    this.claimToken = claimToken;
  }

  queueEvent(event: TelemetryEvent) {
    this.events.push(event);
  }

  /**
   * Remove the last queued event of a given type.
   * Used to swap a provisional event with an updated one.
   */
  replaceLastEventOfType(type: TelemetryEvent['type']): void {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].type === type) {
        this.events.splice(i, 1);
        return;
      }
    }
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
    if (this.events.length === 0) return true;
    if (!this.gatewayUrl) {
      debug('[Telemetry] No gateway URL configured, skipping flush');
      return false;
    }

    const count = this.events.length;
    const payload: TelemetryRequest = { events: this.events.slice(0, count) };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // Read fresh credentials to handle token refresh mid-session
    const freshCreds = getCredentials();
    const token = freshCreds?.accessToken ?? this.accessToken;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (this.claimToken && this.clientId) {
      // Unclaimed environment auth path — guard accepts this instead of JWT
      headers['x-workos-claim-token'] = this.claimToken;
      headers['x-workos-client-id'] = this.clientId;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const eventSummary = payload.events.map((e) => {
        const attrs = e.attributes ?? {};
        switch (e.type) {
          case 'session.start': return `session.start(mode=${attrs['installer.mode']}, os=${attrs['env.os']})`;
          case 'session.end': return `session.end(outcome=${attrs['installer.outcome']}, duration=${attrs['installer.duration_ms']}ms)`;
          case 'step': return `step(${(e as any).name}, ${(e as any).durationMs}ms, success=${(e as any).success})`;
          case 'agent.tool': return `agent.tool(${(e as any).toolName}, ${(e as any).durationMs}ms)`;
          case 'agent.llm': return `agent.llm(${(e as any).model}, in=${(e as any).inputTokens}, out=${(e as any).outputTokens})`;
          case 'command': return `command(${attrs['command.name']}, ${attrs['command.duration_ms']}ms, success=${attrs['command.success']})`;
          case 'crash': return `crash(${attrs['crash.error_type']}: ${attrs['crash.error_message']})`;
          default: return e.type;
        }
      }).join('\n  ');
      debug(`[Telemetry] Sending ${payload.events.length} events to ${this.gatewayUrl}/telemetry:\n  ${eventSummary}`);

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
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(this.events), 'utf-8');
      this.events = [];
    } catch {
      // Silent failure — telemetry must never block exit
    }
  }
}

export const telemetryClient = new TelemetryClient();
