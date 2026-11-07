import { EventEmitter } from 'node:events';

export type SSEChannel = 'task' | 'approval' | 'audit' | 'agent_status';

export interface SSEEvent {
  channel: SSEChannel;
  data: Record<string, unknown>;
}

/**
 * In-process event bus for SSE (T013). Worker events arrive over Redis
 * pub/sub (EVENTS_CHANNEL) and are republished here by index.ts (T025).
 */
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);

export function emitEvent(event: SSEEvent) {
  eventBus.emit('sse', event);
}
