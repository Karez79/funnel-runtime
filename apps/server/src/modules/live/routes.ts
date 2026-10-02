// GET /api/live (CLAUDE.md 11.1): the last entries first, then every new ingest result
// as it happens. Admin only, like the rest of the internal pages.
import { LIVE_STREAM } from '@funnel/shared';
import type { App } from '../../plugins/route.ts';
import type { SseStart } from '../../plugins/sse.ts';
import type { LiveBus } from './bus.ts';

export function liveRoutes(app: App, bus: LiveBus, start: SseStart): void {
  app.get(LIVE_STREAM.path, { onRequest: app.adminGuard }, (_req, reply) => {
    const stream = start(reply);
    stream.send({ boot: bus.boot }, LIVE_STREAM.helloEvent);
    for (const entry of bus.recent()) stream.send(entry);
    stream.onClose(bus.subscribe(stream.send));
  });
}
