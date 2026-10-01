// Database schema, the single source of truth for tables (CLAUDE.md 5).
// SQL migrations are generated from this file by drizzle-kit and never written by hand.
// Everything that depends on a funnel config (event catalog, properties, answers) lives
// in JSON columns, so publishing a new config version never needs a migration.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const funnelVersions = sqliteTable(
  'funnel_versions',
  {
    funnelId: text('funnel_id').notNull(),
    version: integer('version').notNull(),
    configJson: text('config_json').notNull(),
    configHash: text('config_hash').notNull(),
    releaseNote: text('release_note'),
    state: text('state', { enum: ['draft', 'published'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.funnelId, t.version] }),
    check('funnel_versions_state_check', sql`${t.state} IN ('draft','published')`),
  ],
);

/** Append-only activation journal. The active version is the latest row. */
export const funnelActivations = sqliteTable(
  'funnel_activations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    funnelId: text('funnel_id').notNull(),
    version: integer('version').notNull(),
    action: text('action', { enum: ['publish', 'rollback', 'activate'] }).notNull(),
    fromVersion: integer('from_version'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.funnelId, t.version],
      foreignColumns: [funnelVersions.funnelId, funnelVersions.version],
    }),
    check('funnel_activations_action_check', sql`${t.action} IN ('publish','rollback','activate')`),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    funnelId: text('funnel_id').notNull(),
    funnelVersion: integer('funnel_version').notNull(),
    experimentId: text('experiment_id').notNull(),
    variant: text('variant', { enum: ['A', 'B'] }).notNull(),
    variantSource: text('variant_source', { enum: ['hash', 'override'] }).notNull(),
    trafficType: text('traffic_type', { enum: ['live', 'qa', 'synthetic'] })
      .notNull()
      .default('live'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmContent: text('utm_content'),
    utmTerm: text('utm_term'),
    stateJson: text('state_json').notNull(),
    stateRev: integer('state_rev').notNull().default(0),
    resultId: text('result_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.funnelId, t.funnelVersion],
      foreignColumns: [funnelVersions.funnelId, funnelVersions.version],
    }),
    index('sessions_version_idx').on(t.funnelId, t.funnelVersion, t.variant),
    check('sessions_variant_check', sql`${t.variant} IN ('A','B')`),
    check('sessions_variant_source_check', sql`${t.variantSource} IN ('hash','override')`),
    check('sessions_traffic_type_check', sql`${t.trafficType} IN ('live','qa','synthetic')`),
  ],
);

export const events = sqliteTable(
  'events',
  {
    eventId: text('event_id').primaryKey(),
    sessionId: text('session_id').notNull(),
    name: text('name').notNull(),
    funnelId: text('funnel_id').notNull(),
    funnelVersion: integer('funnel_version').notNull(),
    experimentId: text('experiment_id').notNull(),
    variant: text('variant').notNull(),
    stepId: text('step_id'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    clientTs: text('client_ts'),
    serverTs: text('server_ts').notNull(),
    clientSeq: integer('client_seq'),
    origin: text('origin', { enum: ['client', 'server'] }).notNull(),
    propsJson: text('props_json').notNull().default('{}'),
    flagsJson: text('flags_json').notNull().default('{}'),
  },
  (t) => [
    index('events_session_idx').on(t.sessionId),
    index('events_agg_idx').on(t.funnelId, t.funnelVersion, t.variant, t.name),
    index('events_campaign_idx').on(t.utmCampaign),
    check('events_origin_check', sql`${t.origin} IN ('client','server')`),
  ],
);

export const ingestLog = sqliteTable('ingest_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  batchId: text('batch_id'),
  receivedAt: text('received_at').notNull(),
  accepted: integer('accepted').notNull(),
  duplicates: integer('duplicates').notNull(),
  rejected: integer('rejected').notNull(),
});

export const rejectedEvents = sqliteTable('rejected_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  batchId: text('batch_id'),
  eventId: text('event_id'),
  reason: text('reason').notNull(),
  rawJson: text('raw_json').notNull(),
  receivedAt: text('received_at').notNull(),
});
