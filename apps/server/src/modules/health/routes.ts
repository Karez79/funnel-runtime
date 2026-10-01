import { contract } from '@funnel/shared';
import type { App } from '../../plugins/route.ts';
import { route } from '../../plugins/route.ts';
import type { HealthService } from './service.ts';

export function healthRoutes(app: App, service: HealthService): void {
  route(app, contract.health, () => service.status());
}
