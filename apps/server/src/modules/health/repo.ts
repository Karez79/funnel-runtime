import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';

export function createHealthRepo(db: Db) {
  return {
    ping(): boolean {
      try {
        return db.get<{ ok: number }>(sql`select 1 as ok`).ok === 1;
      } catch {
        return false;
      }
    },
  };
}
export type HealthRepo = ReturnType<typeof createHealthRepo>;
