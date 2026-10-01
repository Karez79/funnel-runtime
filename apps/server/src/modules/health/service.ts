import { DomainError, type HealthResponse } from '@funnel/shared';
import type { HealthRepo } from './repo.ts';

export function createHealthService(repo: HealthRepo, buildVersion: string) {
  return {
    status(): HealthResponse {
      if (!repo.ping()) {
        throw new DomainError('unavailable', 'Database unavailable', {
          version: buildVersion,
          db: 'error',
        });
      }
      return { status: 'ok', version: buildVersion, db: 'ok' };
    },
  };
}
export type HealthService = ReturnType<typeof createHealthService>;
