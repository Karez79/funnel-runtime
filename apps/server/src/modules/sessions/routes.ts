import { contract, GENERATOR_KEY_HEADER } from '@funnel/shared';
import type { App, RouteOptions } from '../../plugins/route.ts';
import { route } from '../../plugins/route.ts';
import type { SessionsService } from './service.ts';

export function sessionsRoutes(
  app: App,
  service: SessionsService,
  createOptions: RouteOptions,
): void {
  route(
    app,
    contract.createSession,
    (req) => {
      const key = req.headers[GENERATOR_KEY_HEADER];
      return service.create({
        ...req.body,
        generatorKey: typeof key === 'string' ? key : undefined,
      });
    },
    createOptions,
  );
  route(app, contract.getSession, (req) => service.get(req.params.id));
  route(app, contract.saveState, (req) =>
    service.saveState(req.params.id, req.body.state, req.body.baseRev),
  );
  route(app, contract.completeSession, (req) => service.complete(req.params.id));
}
