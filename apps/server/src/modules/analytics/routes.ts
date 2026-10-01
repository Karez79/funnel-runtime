import { contract } from '@funnel/shared';
import type { App } from '../../plugins/route.ts';
import { route } from '../../plugins/route.ts';
import type { AnalyticsService } from './service.ts';

export function analyticsRoutes(app: App, service: AnalyticsService): void {
  route(app, contract.analyticsFilters, () => service.filters());
  route(app, contract.analyticsSummary, (req) => service.summary(req.query));
}
