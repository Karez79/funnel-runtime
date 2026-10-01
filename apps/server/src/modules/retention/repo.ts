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
            // One malformed row must not abort the whole statement: json_extract throws on
            // invalid JSON, and SQLite does not promise the order of AND terms, so the
            // validity check guards the extraction inside one CASE.
            sql`case when json_valid(${sessions.stateJson})
              then json_extract(${sessions.stateJson}, '$.answers') != '{}' end`,
          ),
        )
        .run().changes;
    },
  };
}
export type RetentionRepo = ReturnType<typeof createRetentionRepo>;
