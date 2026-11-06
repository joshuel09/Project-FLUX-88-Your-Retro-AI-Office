import { EventEmitter } from 'node:events';

export type SSEChannel = 'task' | 'approval' | 'audit' | 'agent_status';

export interface SSEEvent {
  channel: SSEChannel;
  data: Record<string, unknown>;
}

/**
 * In-process event bus for SSE (T013). Worker→API bridging via Redis pub/sub
 * arrives with US1 (T025); this slice only needs API-originated events.
 */
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);

export function emitEvent(event: SSEEvent) {
  eventBus.emit('sse', event);
}
