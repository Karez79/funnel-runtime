import { and, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { sessions } from '../../db/schema.ts';

export function createRetentionRepo(db: Db) {
  return {
    /** Empties `answers` in the state of sessions expired at `nowIso`; returns how many. */
    clearExpiredAnswers(nowIso: string): number {
      return db
        .update(sessions)
        .set({ stateJson: sql`json_set(${sessions.stateJson}, '$.answers', json('{}'))` })
        .where(
          and(
            lte(sessions.expiresAt, nowIso),
            // One malformed row must not abort the whole statement (json_extract throws).
            sql`json_valid(${sessions.stateJson})`,
            sql`json_extract(${sessions.stateJson}, '$.answers') != '{}'`,
          ),
        )
        .run().changes;
    },
  };
}
export type RetentionRepo = ReturnType<typeof createRetentionRepo>;
