// Session rows (CLAUDE.md 5, 6.2). A session is created together with its server-side
// `session_started` event in one transaction, so "Started" in analytics can never miss
// a session or count one that failed to be stored. better-sqlite3 is synchronous and
// the server is one process, so a read-check-write in a service cannot interleave with
// another request: the optimistic lock on `state_rev` is checked in the service.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { events, sessions } from '../../db/schema.ts';

export type SessionRow = typeof sessions.$inferSelect;
type NewSession = typeof sessions.$inferInsert;
type NewEvent = typeof events.$inferInsert;

export function createSessionsRepo(db: Db) {
  return {
    insertWithEvent(session: NewSession, event: NewEvent): void {
      db.transaction((tx) => {
        tx.insert(sessions).values(session).run();
        tx.insert(events).values(event).run();
      });
    },

    get(id: string): SessionRow | undefined {
      return db.select().from(sessions).where(eq(sessions.id, id)).get();
    },

    /**
     * Writes a new state only if `state_rev` is still `baseRev` (the lock holds in SQL
     * too, not only in the service); returns false when another write got there first.
     */
    saveState(id: string, stateJson: string, baseRev: number, updatedAt: string): boolean {
      const { changes } = db
        .update(sessions)
        .set({ stateJson, stateRev: baseRev + 1, updatedAt })
        .where(and(eq(sessions.id, id), eq(sessions.stateRev, baseRev)))
        .run();
      return changes === 1;
    },

    setResult(id: string, resultId: string, updatedAt: string): void {
      db.update(sessions).set({ resultId, updatedAt }).where(eq(sessions.id, id)).run();
    },
  };
}
export type SessionsRepo = ReturnType<typeof createSessionsRepo>;
