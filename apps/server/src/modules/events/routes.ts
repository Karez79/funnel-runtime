import { contract, GENERATOR_KEY_HEADER } from '@funnel/shared';
import type { App, RouteOptions } from '../../plugins/route.ts';
import { route } from '../../plugins/route.ts';
import type { EventsService } from './service.ts';

export function eventsRoutes(app: App, service: EventsService, options: RouteOptions): void {
  route(
    app,
    contract.eventsBatch,
    (req) => {
      const key = req.headers[GENERATOR_KEY_HEADER];
      return service.ingest(req.body, typeof key === 'string' ? key : undefined);
    },
    options,
  );
}
