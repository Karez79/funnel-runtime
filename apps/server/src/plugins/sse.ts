// Server-sent events (CLAUDE.md 11.1, 6.0). The response is taken over from Fastify
// (`hijack`) and kept open; a comment line every `heartbeatMs` stops proxies such as
// Railway's edge from closing an idle stream. Every open stream is tracked so a graceful
// shutdown (SIGTERM on each redeploy) can end them: otherwise `app.close()` would wait
// for clients that never disconnect.
import type { FastifyReply } from 'fastify';
import type { App } from './route.ts';

export interface SseStream {
  send: (data: unknown) => void;
  /** Called once when the client goes away or the server shuts down. */
  onClose: (listener: () => void) => void;
}

/** Unsent bytes a slow client may hold before its stream is dropped. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

export function sseStreams(app: App, heartbeatMs: number) {
  const open = new Set<() => void>();

  app.addHook('preClose', (done) => {
    for (const end of [...open]) end();
    done();
  });

  return function start(reply: FastifyReply): SseStream {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Some proxies buffer responses unless told not to.
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');

    const listeners: (() => void)[] = [];
    let closed = false;
    // A client that stops reading (a stalled tab) would make every entry pile up in
    // memory; past the cap the stream is dropped and EventSource reconnects with the
    // backlog. It is destroyed, not ended: `end()` would only queue a FIN behind the
    // buffered megabyte, and a hijacked response has no timeout to free it.
    const write = (chunk: string) => {
      if (closed) return;
      if (!res.write(chunk) && res.writableLength > MAX_BUFFERED_BYTES) end('destroy');
    };
    const heartbeat = setInterval(() => {
      write(': heartbeat\n\n');
    }, heartbeatMs);
    const end = (how: 'end' | 'destroy' = 'end') => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      open.delete(end);
      if (how === 'destroy') res.destroy();
      else if (!res.writableEnded) res.end();
      for (const listener of listeners) listener();
    };
    open.add(end);
    res.on('close', () => {
      end();
    });

    return {
      send: (data) => {
        write(`data: ${JSON.stringify(data)}\n\n`);
      },
      onClose: (listener) => {
        listeners.push(listener);
      },
    };
  };
}
export type SseStart = ReturnType<typeof sseStreams>;
