import { contract, GENERATOR_KEY_HEADER } from '@funnel/shared';
import type { FastifyRequest } from 'fastify';
import type { App } from '../../plugins/route.ts';
import { route } from '../../plugins/route.ts';
import type { AnalyticsService } from './service.ts';

export function analyticsRoutes(app: App, service: AnalyticsService): void {
  route(app, contract.analyticsFilters, () => service.filters());
  route(app, contract.analyticsSummary, (req) => service.summary(req.query));
  const generatorKey = (req: FastifyRequest) => {
    const key = req.headers[GENERATOR_KEY_HEADER];
    return typeof key === 'string' ? key : undefined;
  };
  route(
    app,
    contract.uploadGroundTruth,
    (req) => service.uploadGroundTruth(req.body, generatorKey(req)),
    // The key before the body: without it, even a broken file is a 403.
    {
      precheck: (req) => {
        service.assertGeneratorKey(generatorKey(req));
      },
    },
  );
}
