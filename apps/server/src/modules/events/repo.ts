// Event rows (CLAUDE.md 5, 7.3). Deduplication is the primary key: `ON CONFLICT(event_id)
// DO NOTHING` makes a replayed event a no-op, and `changes` tells the service whether the
// row was new. A batch, its rejections and its ingest_log row are written in one
// transaction, so a crash never leaves half a batch stored.
import { desc, eq, max, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { events, ingestLog, rejectedEvents, sessions } from '../../db/schema.ts';

type NewEvent = typeof events.$inferInsert;
type NewRejected = typeof rejectedEvents.$inferInsert;

/** The session columns ingest trusts instead of what the client sent (6.3). */
export type IngestSession = Pick<
  typeof sessions.$inferSelect,
  | 'id'
  | 'funnelId'
  | 'funnelVersion'
  | 'experimentId'
  | 'variant'
  | 'utmSource'
  | 'utmMedium'
  | 'utmCampaign'
>;

export function createEventsRepo(db: Db) {
  return {
    session(id: string): IngestSession | undefined {
      return db
        .select({
          id: sessions.id,
          funnelId: sessions.funnelId,
          funnelVersion: sessions.funnelVersion,
          experimentId: sessions.experimentId,
          variant: sessions.variant,
          utmSource: sessions.utmSource,
          utmMedium: sessions.utmMedium,
          utmCampaign: sessions.utmCampaign,
        })
        .from(sessions)
        .where(eq(sessions.id, id))
        .get();
    },

    /**
     * The newest client events and rejections, newest first, for the Live feed after a
     * restart. Duplicates are not rows (only counts in ingest_log), so they cannot return.
     */
    recentForLive(limit: number) {
      const stored = db
        .select({
          eventId: events.eventId,
          sessionId: events.sessionId,
          name: events.name,
          stepId: events.stepId,
          version: events.funnelVersion,
          variant: events.variant,
          receivedAt: events.serverTs,
        })
        .from(events)
        .where(eq(events.origin, 'client'))
        .orderBy(desc(sql`rowid`))
        .limit(limit)
        .all();
      const rejected = db
        .select({
          eventId: rejectedEvents.eventId,
          reason: rejectedEvents.reason,
          rawJson: rejectedEvents.rawJson,
          receivedAt: rejectedEvents.receivedAt,
        })
        .from(rejectedEvents)
        .orderBy(desc(rejectedEvents.id))
        .limit(limit)
        .all();
      return { stored, rejected };
    },

    /** Highest `client_seq` stored for the session; null before its first client event. */
    maxClientSeq(sessionId: string): number | null {
      const row = db
        .select({ seq: max(events.clientSeq) })
        .from(events)
        .where(eq(events.sessionId, sessionId))
        .get();
      return row?.seq ?? null;
    },

    /**
     * Inserts the batch with its rejections and its ingest_log row in one transaction and
     * reports, per event, whether it was new (false: the event_id was already stored).
     */
    writeBatch(
      rows: NewEvent[],
      rejected: NewRejected[],
      batch: { batchId: string | null; receivedAt: string; generated: boolean },
    ): boolean[] {
      return db.transaction((tx) => {
        const inserted = rows.map(
          (row) => tx.insert(events).values(row).onConflictDoNothing().run().changes > 0,
        );
        if (rejected.length > 0) tx.insert(rejectedEvents).values(rejected).run();
        const accepted = inserted.filter(Boolean).length;
        tx.insert(ingestLog)
          .values({
            ...batch,
            accepted,
            duplicates: inserted.length - accepted,
            rejected: rejected.length,
          })
          .run();
        return inserted;
      });
    },
  };
}
export type EventsRepo = ReturnType<typeof createEventsRepo>;
