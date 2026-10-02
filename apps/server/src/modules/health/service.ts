// Health and the schema fingerprint: both describe the running server itself, not the
// funnel. The fingerprint lets a script prove over HTTP that publishing a version ran no
// DDL (CLAUDE.md 5: the second iteration needs no migration).
import { createHash } from 'node:crypto';
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
    /** A fingerprint of the schema: equal before and after a publish means no DDL ran. */
    schema() {
      const { objects, migrations } = repo.schema();
      const hash = createHash('sha256').update(JSON.stringify(objects)).digest('hex');
      return { hash, objects: objects.length, migrations };
    },
  };
}
export type HealthService = ReturnType<typeof createHealthService>;
