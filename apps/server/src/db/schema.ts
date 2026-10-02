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
import {
  ACTIVATION_ACTIONS,
  TRAFFIC_TYPES,
  VARIANT_SOURCES,
  VARIANTS,
  VERSION_STATES,
} from '@funnel/shared';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

const EVENT_ORIGINS = ['client', 'server'] as const;

/** CHECK (column IN (...)) from the shared value list, so it cannot drift from the domain type. */
const oneOf = (name: string, column: SQLiteColumn, values: readonly string[]) =>
  check(name, sql`${column} IN ${sql.raw(`(${values.map((v) => `'${v}'`).join(',')})`)}`);

/**
 * True when the row was written for a request carrying a valid GENERATOR_KEY: the
 * generator's ground-truth checks count only its own rows (analytics `traffic=generator`),
 * so real visitors on the public URL during a run cannot change the expected numbers.
 */
const generated = () => integer('generated', { mode: 'boolean' }).notNull().default(false);

export const funnelVersions = sqliteTable(
  'funnel_versions',
  {
    funnelId: text('funnel_id').notNull(),
    version: integer('version').notNull(),
    configJson: text('config_json').notNull(),
    configHash: text('config_hash').notNull(),
    releaseNote: text('release_note'),
    state: text('state', { enum: VERSION_STATES }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.funnelId, t.version] }),
    oneOf('funnel_versions_state_check', t.state, VERSION_STATES),
  ],
);

/** Append-only activation journal. The active version is the latest row. */
export const funnelActivations = sqliteTable(
  'funnel_activations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    funnelId: text('funnel_id').notNull(),
    version: integer('version').notNull(),
    action: text('action', { enum: ACTIVATION_ACTIONS }).notNull(),
    fromVersion: integer('from_version'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.funnelId, t.version],
      foreignColumns: [funnelVersions.funnelId, funnelVersions.version],
    }),
    oneOf('funnel_activations_action_check', t.action, ACTIVATION_ACTIONS),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    funnelId: text('funnel_id').notNull(),
    funnelVersion: integer('funnel_version').notNull(),
    experimentId: text('experiment_id').notNull(),
    variant: text('variant', { enum: VARIANTS }).notNull(),
    variantSource: text('variant_source', { enum: VARIANT_SOURCES }).notNull(),
    trafficType: text('traffic_type', { enum: TRAFFIC_TYPES }).notNull().default('live'),
    generated: generated(),
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
    oneOf('sessions_variant_check', t.variant, VARIANTS),
    oneOf('sessions_variant_source_check', t.variantSource, VARIANT_SOURCES),
    oneOf('sessions_traffic_type_check', t.trafficType, TRAFFIC_TYPES),
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
    origin: text('origin', { enum: EVENT_ORIGINS }).notNull(),
    propsJson: text('props_json').notNull().default('{}'),
    flagsJson: text('flags_json').notNull().default('{}'),
  },
  (t) => [
    index('events_session_idx').on(t.sessionId),
    index('events_agg_idx').on(t.funnelId, t.funnelVersion, t.variant, t.name),
    index('events_campaign_idx').on(t.utmCampaign),
    oneOf('events_origin_check', t.origin, EVENT_ORIGINS),
  ],
);

export const ingestLog = sqliteTable('ingest_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  batchId: text('batch_id'),
  receivedAt: text('received_at').notNull(),
  accepted: integer('accepted').notNull(),
  duplicates: integer('duplicates').notNull(),
  rejected: integer('rejected').notNull(),
  generated: generated(),
});

export const rejectedEvents = sqliteTable('rejected_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  batchId: text('batch_id'),
  eventId: text('event_id'),
  reason: text('reason').notNull(),
  rawJson: text('raw_json').notNull(),
  receivedAt: text('received_at').notNull(),
  generated: generated(),
});

/**
 * Ground truth uploads of the traffic generator (CLAUDE.md 9.1), append-only; the newest
 * row drives "Matches generator ground truth". Stored on the server because the prod
 * dashboard cannot read a file from the machine that ran the generator.
 */
export const groundTruth = sqliteTable('ground_truth', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: text('created_at').notNull(),
  json: text('json').notNull(),
});
