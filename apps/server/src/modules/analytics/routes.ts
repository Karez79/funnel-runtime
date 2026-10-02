import { contract, GENERATOR_KEY_HEADER } from '@funnel/shared';
import type { App } from '../../plugins/route.ts';
import { route } from '../../plugins/route.ts';
import type { AnalyticsService } from './service.ts';

export function analyticsRoutes(app: App, service: AnalyticsService): void {
  route(app, contract.analyticsFilters, () => service.filters());
  route(app, contract.analyticsSummary, (req) => service.summary(req.query));
  route(app, contract.uploadGroundTruth, (req) => {
    const key = req.headers[GENERATOR_KEY_HEADER];
    return service.uploadGroundTruth(req.body, typeof key === 'string' ? key : undefined);
  });
}
