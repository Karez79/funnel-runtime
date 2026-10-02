import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';

export function createHealthRepo(db: Db) {
  return {
    /** Schema objects in a fixed order, and how many migrations Drizzle applied. */
    schema() {
      return {
        objects: db.all<{ type: string; name: string; sql: string | null }>(
          sql`select type, name, sql from sqlite_master order by type, name`,
        ),
        migrations: db.get<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`).n,
      };
    },
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
