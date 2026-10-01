import type { HealthResponse } from '@funnel/shared';
import type { HealthRepo } from './repo.ts';

export function createHealthService(repo: HealthRepo, buildVersion: string) {
  return {
    status(): HealthResponse {
      const dbOk = repo.ping();
      return { status: dbOk ? 'ok' : 'degraded', version: buildVersion, db: dbOk ? 'ok' : 'error' };
    },
  };
}
export type HealthService = ReturnType<typeof createHealthService>;
