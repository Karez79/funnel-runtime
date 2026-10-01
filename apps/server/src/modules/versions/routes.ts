import { contract } from '@funnel/shared';
import type { App } from '../../plugins/route.ts';
import { route } from '../../plugins/route.ts';
import type { VersionsService } from './service.ts';

export function versionsRoutes(app: App, service: VersionsService): void {
  const { admin } = service;

  route(app, contract.activeFunnel, (req) => {
    const { version, config } = service.active(req.params.funnelId);
    return { funnelId: config.funnelId, version, title: config.title };
  });

  route(app, contract.listVersions, () => admin.list());
  route(app, contract.activeVersion, () => admin.activeDetails());
  route(app, contract.uploadVersion, (req) => admin.uploadVersion(req.body, req.query.releaseNote));
  route(app, contract.versionDiff, (req) => admin.diff(req.params.v, req.query.against));
  route(app, contract.publishVersion, (req) => admin.publishVersion(req.params.v, req.body.note));
  route(app, contract.activateVersion, (req) => admin.activateVersion(req.params.v, req.body.note));
  route(app, contract.rollback, (req) => admin.rollback(req.body.note));
  route(app, contract.previewVersion, (req) => admin.preview(req.params.v, req.query.variant));
}
