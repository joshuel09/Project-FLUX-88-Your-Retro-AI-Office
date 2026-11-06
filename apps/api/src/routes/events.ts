import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { eventBus, type SSEEvent } from '../events.js';

export function eventsRoutes() {
  const app = new Hono();

  app.get('/', (c) =>
    streamSSE(c, async (stream) => {
      let alive = true;
      const listener = (event: SSEEvent) => {
        if (!alive) return;
        void stream.writeSSE({ event: event.channel, data: JSON.stringify(event.data) });
      };
      eventBus.on('sse', listener);
      stream.onAbort(() => {
        alive = false;
        eventBus.off('sse', listener);
      });
      // Heartbeat keeps proxies from buffering/closing the stream.
      while (alive) {
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
        await stream.sleep(25_000);
      }
    }),
  );

  return app;
}
