// Session rows (CLAUDE.md 5, 6.2). A session is created together with its server-side
// `session_started` event in one transaction, so "Started" in analytics can never miss
// a session or count one that failed to be stored.
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
  };
}
export type SessionsRepo = ReturnType<typeof createSessionsRepo>;
