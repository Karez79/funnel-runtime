// Session rows (CLAUDE.md 5, 6.2). A session is created together with its server-side
// `session_started` event in one transaction, so "Started" in analytics can never miss
// a session or count one that failed to be stored. better-sqlite3 is synchronous and
// the server is one process, so a read-check-write in a service cannot interleave with
// another request: the optimistic lock on `state_rev` is checked in the service.
import { eq } from 'drizzle-orm';
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

    /** Writes a new state and bumps `state_rev`; the caller has checked the base revision. */
    saveState(id: string, stateJson: string, stateRev: number, updatedAt: string): void {
      db.update(sessions).set({ stateJson, stateRev, updatedAt }).where(eq(sessions.id, id)).run();
    },

    setResult(id: string, resultId: string, updatedAt: string): void {
      db.update(sessions).set({ resultId, updatedAt }).where(eq(sessions.id, id)).run();
    },
  };
}
export type SessionsRepo = ReturnType<typeof createSessionsRepo>;
