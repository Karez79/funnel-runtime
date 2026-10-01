import { contract } from '@funnel/shared';
import type { App, RouteOptions } from '../../plugins/route.ts';
import { route } from '../../plugins/route.ts';
import type { EventsService } from './service.ts';

export function eventsRoutes(app: App, service: EventsService, options: RouteOptions): void {
  route(app, contract.eventsBatch, (req) => service.ingest(req.body), options);
}
