// Row selection for the analytics API (CLAUDE.md 11.2). SQL narrows the rows by the
// filters that live on the session row (funnel, QA, campaign, period); every metric is
// computed by the shared aggregator, never here. Raw answers (`state_json`) are never
// selected: analytics has no use for them (5, privacy).
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  lte,
  ne,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../../db/client.ts';
import { events, groundTruth, ingestLog, rejectedEvents, sessions } from '../../db/schema.ts';

export interface Period {
  from?: string | undefined;
  to?: string | undefined;
}

export interface SessionScope extends Period {
  funnelId: string;
  includeQa: boolean;
  campaign?: string | undefined;
}

/** Timestamps are stored as UTC ISO strings, so string comparison is time order. */
const within = (column: SQLiteColumn, period: Period) =>
  and(
    period.from === undefined ? undefined : gte(column, period.from),
    period.to === undefined ? undefined : lte(column, period.to),
  );

function sessionWhere(scope: SessionScope): SQL | undefined {
  return and(
    eq(sessions.funnelId, scope.funnelId),
    scope.includeQa ? undefined : ne(sessions.trafficType, 'qa'),
    scope.campaign === undefined ? undefined : eq(sessions.utmCampaign, scope.campaign),
    within(sessions.createdAt, scope),
  );
}

export function createAnalyticsRepo(db: Db) {
  return {
    sessions(scope: SessionScope) {
      return db
        .select({
          id: sessions.id,
          version: sessions.funnelVersion,
          variant: sessions.variant,
          trafficType: sessions.trafficType,
          utmSource: sessions.utmSource,
          utmCampaign: sessions.utmCampaign,
          resultId: sessions.resultId,
          createdAt: sessions.createdAt,
        })
        .from(sessions)
        .where(sessionWhere(scope))
        .all();
    },

    /** Events of the sessions in scope; version and variant come from the session row. */
    events(scope: SessionScope) {
      return db
        .select({
          eventId: events.eventId,
          sessionId: events.sessionId,
          name: events.name,
          stepId: events.stepId,
          serverTs: events.serverTs,
          propsJson: events.propsJson,
          flagsJson: events.flagsJson,
        })
        .from(events)
        .innerJoin(sessions, eq(events.sessionId, sessions.id))
        .where(sessionWhere(scope))
        .all();
    },

    duplicates(period: Period): number {
      const row = db
        .select({ n: sum(ingestLog.duplicates) })
        .from(ingestLog)
        .where(within(ingestLog.receivedAt, period))
        .get();
      return Number(row?.n ?? 0);
    },

    rejectedByReason(period: Period) {
      return db
        .select({ reason: rejectedEvents.reason, count: count() })
        .from(rejectedEvents)
        .where(within(rejectedEvents.receivedAt, period))
        .groupBy(rejectedEvents.reason)
        .orderBy(asc(rejectedEvents.reason))
        .all();
    },

    /**
     * Distinct non-empty values of a UTM column, for the filter lists. QA sessions are
     * left out: a value only they carry would select an empty dashboard by default.
     */
    utmValues(funnelId: string, column: 'utmCampaign' | 'utmSource'): string[] {
      const field = sessions[column];
      return db
        .selectDistinct({ value: sql<string>`${field}` })
        .from(sessions)
        .where(
          and(eq(sessions.funnelId, funnelId), ne(sessions.trafficType, 'qa'), isNotNull(field)),
        )
        .orderBy(asc(field))
        .all()
        .map((row) => row.value);
    },

    saveGroundTruth(json: string, createdAt: string): void {
      db.insert(groundTruth).values({ json, createdAt }).run();
    },

    /** The newest uploaded ground truth as stored, or undefined before the first upload. */
    latestGroundTruth(): string | undefined {
      return db
        .select({ json: groundTruth.json })
        .from(groundTruth)
        .orderBy(desc(groundTruth.id))
        .limit(1)
        .get()?.json;
    },
  };
}
export type AnalyticsRepo = ReturnType<typeof createAnalyticsRepo>;
