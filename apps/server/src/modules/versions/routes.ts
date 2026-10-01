import { contract } from '@funnel/shared';
import type { App } from '../../plugins/route.ts';
import { route } from '../../plugins/route.ts';
import type { VersionsService } from './service.ts';

export function versionsRoutes(app: App, service: VersionsService): void {
  route(app, contract.activeFunnel, (req) => {
    const { version, config } = service.active(req.params.funnelId);
    return { funnelId: config.funnelId, version, title: config.title };
  });
}
