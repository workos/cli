import { createInstallerEventEmitter, type InstallerEventName, type InstallerEvents } from './events.js';

/**
 * Captured event with type and payload.
 */
export interface CapturedEvent<K extends InstallerEventName = InstallerEventName> {
  type: K;
  payload: InstallerEvents[K];
  timestamp: number;
}

/**
 * Creates an event capture utility for testing.
 * Records all events emitted through the emitter.
 */
export function createEventCapture() {
  const emitter = createInstallerEventEmitter();
  const events: CapturedEvent[] = [];

  // All event types to capture
  const eventTypes: InstallerEventName[] = [
    'status',
    'output',
    'complete',
    'error',
    'state:enter',
    'state:exit',
    'auth:checking',
    'auth:required',
    'auth:success',
    'auth:failure',
    'detection:start',
    'detection:complete',
    'detection:none',
    'git:checking',
    'git:clean',
    'git:dirty',
    'git:dirty:confirmed',
    'git:dirty:cancelled',
    'credentials:gathering',
    'credentials:found',
    'credentials:request',
    'credentials:response',
    'config:start',
    'config:complete',
    'agent:start',
    'agent:progress',
    'agent:success',
    'agent:failure',
    'agent:tool',
    'file:write',
    'file:edit',
    'prompt:request',
    'prompt:response',
    'confirm:request',
    'confirm:response',
  ];

  // Subscribe to all event types
  for (const type of eventTypes) {
    emitter.on(type, (payload: InstallerEvents[typeof type]) => {
      events.push({
        type,
        payload,
        timestamp: Date.now(),
      });
    });
  }

  return {
    /** The emitter to pass to machine/adapters */
    emitter,

    /** Get all captured events */
    getEvents: () => [...events],

    /** Get just the event types in order */
    getEventTypes: () => events.map((e) => e.type),

    /** Get events of a specific type */
    getEventsOfType: <K extends InstallerEventName>(type: K): CapturedEvent<K>[] =>
      events.filter((e): e is CapturedEvent<K> => e.type === type),

    /** Clear captured events */
    clear: () => {
      events.length = 0;
    },

    /** Get count of events */
    count: () => events.length,
  };
}
