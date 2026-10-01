// HTTP contract shared by server, web client and generator (CLAUDE.md 3.1).
// The server registers routes from these definitions; clients call them through
// the same definitions, so a path or a body shape lives in exactly one place.
// Success has exactly one status and schema per route; every failure is a
// DomainError rendered as the shared ErrorBody envelope (see errors.ts).
import { z } from 'zod';
import type { ErrorCode } from './errors.ts';
import { ACTIVATION_ACTIONS, VARIANT_SOURCES, VERSION_STATES } from './domain.ts';
import { AnalyticsFiltersSchema, AnalyticsSummarySchema } from '../analytics/summary.ts';
import { ConfigChangeSchema } from '../config/diff.ts';
import { LintReportSchema } from '../config/lint.ts';
import { ResultSchema, VARIANTS } from '../config/schema.ts';
import { AnswerValueSchema } from '../engine/conditions.ts';
import { VALIDATION_CODES } from '../engine/validation.ts';
import { ResolvedFunnelSchema } from '../engine/resolve.ts';
import { BatchEnvelopeSchema, BatchResponseSchema, REJECT_REASONS } from '../events/schema.ts';

type Method = 'GET' | 'POST' | 'PUT';

export interface RouteDef {
  readonly method: Method;
  readonly path: string;
  readonly auth: 'public' | 'admin';
  readonly status?: 200 | 201;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  /** Max request body in bytes; falls back to the server default. */
  readonly bodyLimit?: number;
  readonly response: z.ZodType;
  /** Shape of `error.details` for failures that carry data the client acts on. */
  readonly errorDetails?: Partial<Record<ErrorCode, z.ZodType>>;
}

/** Synthetic traffic is accepted only with this header carrying `GENERATOR_KEY` (6.2). */
export const GENERATOR_KEY_HEADER = 'x-generator-key';

const KB = 1024;
const Variant = z.enum(VARIANTS);
const Version = z.coerce.number().int().positive();
const Timestamp = z.iso.datetime({ offset: true });

const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  db: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// ---------- sessions (6.2) ----------

export const SessionStateSchema = z.object({
  answers: z.record(z.string(), AnswerValueSchema),
  /** Steps visited before the current one; Back pops it (4.4). */
  history: z.array(z.string()),
  currentStepId: z.string().min(1),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

const Utm = z.object({
  source: z.string().max(200).optional(),
  medium: z.string().max(200).optional(),
  campaign: z.string().max(200).optional(),
  content: z.string().max(200).optional(),
  term: z.string().max(200).optional(),
});

const SessionSchema = z.object({
  id: z.string(),
  funnelVersion: z.number().int().positive(),
  experimentId: z.string(),
  variant: Variant,
  /** Shown by the debug overlay (8.5). */
  variantSource: z.enum(VARIANT_SOURCES),
  state: SessionStateSchema,
  stateRev: z.number().int().nonnegative(),
  resultId: z.string().nullable(),
  expiresAt: Timestamp,
});

const SessionResponse = z.object({ session: SessionSchema, funnel: ResolvedFunnelSchema });
export type SessionResponse = z.infer<typeof SessionResponse>;

const SessionParams = z.object({ id: z.string().min(1).max(100) });

/** `error.details` of a 409 on saveState: the server's state, which the client adopts. */
export const StateConflictDetailsSchema = z.object({
  state: SessionStateSchema,
  stateRev: z.number().int().nonnegative(),
});

/**
 * `error.details` of a 422 on saveState and completeSession: which step or answer key
 * is wrong and the validation code. Never the answer value (privacy, 7.2).
 */
export const SessionUnprocessableDetailsSchema = z.union([
  z.object({ stepId: z.string(), code: z.enum(VALIDATION_CODES).optional() }),
  z.object({ answer: z.string() }),
]);

// ---------- versions (6.1) ----------

const VersionSummary = z.object({
  funnelId: z.string(),
  version: z.number().int().positive(),
  title: z.string(),
  state: z.enum(VERSION_STATES),
  releaseNote: z.string().nullable(),
  createdAt: Timestamp,
  /** When it last became the active version; null if never. */
  activatedAt: Timestamp.nullable(),
  active: z.boolean(),
  /** Not expired and without a result. */
  activeSessions: z.number().int().nonnegative(),
  totalSessions: z.number().int().nonnegative(),
});
export type VersionSummary = z.infer<typeof VersionSummary>;

const Activation = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  action: z.enum(ACTIVATION_ACTIONS),
  fromVersion: z.number().int().positive().nullable(),
  note: z.string().nullable(),
  createdAt: Timestamp,
});

const VersionParams = z.object({ v: Version });
/** Optional note stored in the activation journal (5). */
const ActivationBody = z.object({ note: z.string().max(500).optional() }).default({});
const ActivationResponse = z.object({ activation: Activation });

// ---------- live (11.1) ----------

/** One line of the Live events stream (`GET /api/live`, server-sent events). */
export const LiveEntrySchema = z.object({
  /**
   * Increases with every entry the server publishes, also across restarts: the client's
   * row identity. One batch can hold the same event several times with one receive time,
   * so nothing else in the entry tells two results apart.
   */
  seq: z.number().int().positive(),
  receivedAt: Timestamp,
  eventId: z.string().nullable(),
  sessionId: z.string().nullable(),
  name: z.string().nullable(),
  stepId: z.string().nullable(),
  version: z.number().int().positive().nullable(),
  variant: Variant.nullable(),
  status: z.enum(['accepted', 'duplicate', 'rejected']),
  reason: z.enum(REJECT_REASONS).nullable(),
});
export type LiveEntry = z.infer<typeof LiveEntrySchema>;
/** An entry before the live bus numbers it. */
export type LiveEntryDraft = Omit<LiveEntry, 'seq'>;

export const contract = {
  health: {
    method: 'GET',
    path: '/api/health',
    auth: 'public',
    response: HealthResponse,
  },

  // Only meta of the active version; the funnel itself reaches the client via a session (6.4).
  activeFunnel: {
    method: 'GET',
    path: '/api/funnel/:funnelId/active',
    auth: 'public',
    params: z.object({ funnelId: z.string().min(1) }),
    response: z.object({ funnelId: z.string(), version: z.number().int(), title: z.string() }),
  },

  createSession: {
    method: 'POST',
    path: '/api/sessions',
    auth: 'public',
    status: 201,
    bodyLimit: 8 * KB,
    body: z.object({
      funnelId: z.string().min(1),
      utm: Utm.default({}),
      variantOverride: Variant.optional(),
      /** Needs the generator header; otherwise the request is forbidden. */
      trafficType: z.literal('synthetic').optional(),
    }),
    response: SessionResponse,
  },
  getSession: {
    method: 'GET',
    path: '/api/sessions/:id',
    auth: 'public',
    params: SessionParams,
    response: SessionResponse,
  },
  /** 409 `conflict` with `details: { state, stateRev }` when `baseRev` is stale. */
  saveState: {
    method: 'PUT',
    path: '/api/sessions/:id/state',
    auth: 'public',
    bodyLimit: 64 * KB,
    params: SessionParams,
    body: z.object({ state: SessionStateSchema, baseRev: z.number().int().nonnegative() }),
    response: z.object({ stateRev: z.number().int().positive() }),
    errorDetails: {
      conflict: StateConflictDetailsSchema,
      unprocessable: SessionUnprocessableDetailsSchema,
    },
  },
  completeSession: {
    method: 'POST',
    path: '/api/sessions/:id/complete',
    auth: 'public',
    params: SessionParams,
    response: z.object({ resultId: z.string(), result: ResultSchema }),
    errorDetails: { unprocessable: SessionUnprocessableDetailsSchema },
  },

  eventsBatch: {
    method: 'POST',
    path: '/api/events/batch',
    auth: 'public',
    bodyLimit: 256 * KB,
    body: BatchEnvelopeSchema,
    response: BatchResponseSchema,
  },

  listVersions: {
    method: 'GET',
    path: '/api/admin/versions',
    auth: 'admin',
    response: z.object({ versions: z.array(VersionSummary), activations: z.array(Activation) }),
  },
  activeVersion: {
    method: 'GET',
    path: '/api/admin/versions/active',
    auth: 'admin',
    // The stored config as uploaded (status in the JSON is ignored, 4.1).
    response: z.object({ version: VersionSummary, config: z.record(z.string(), z.unknown()) }),
  },
  /**
   * Body is the raw config JSON; schema problems are 422 with the issues in `details`.
   * Always 201: a re-upload of the same config hash answers with the stored version and
   * `created: false`, so the client handles both cases the same way.
   */
  uploadVersion: {
    method: 'POST',
    path: '/api/admin/versions',
    auth: 'admin',
    status: 201,
    bodyLimit: 512 * KB,
    query: z.object({ releaseNote: z.string().max(500).optional() }),
    body: z.unknown(),
    errorDetails: { unprocessable: z.object({ issues: z.array(z.string()) }) },
    response: z.object({
      version: VersionSummary,
      lint: LintReportSchema,
      /** false when the same config_hash was already stored (idempotent upload). */
      created: z.boolean(),
    }),
  },
  versionDiff: {
    method: 'GET',
    path: '/api/admin/versions/:v/diff',
    auth: 'admin',
    params: VersionParams,
    query: z.object({ against: z.union([z.literal('active'), Version]).default('active') }),
    response: z.object({
      version: z.number().int().positive(),
      against: z.number().int().positive().nullable(),
      changes: z.array(ConfigChangeSchema),
      lint: LintReportSchema,
    }),
  },
  /** 422 `unprocessable` with the lint errors in `details` when lint fails. */
  publishVersion: {
    method: 'POST',
    path: '/api/admin/versions/:v/publish',
    auth: 'admin',
    params: VersionParams,
    body: ActivationBody,
    response: ActivationResponse,
    errorDetails: { unprocessable: LintReportSchema },
  },
  activateVersion: {
    method: 'POST',
    path: '/api/admin/versions/:v/activate',
    auth: 'admin',
    params: VersionParams,
    body: ActivationBody,
    response: ActivationResponse,
  },
  /** 409 `conflict` when there is no previous active version. */
  rollback: {
    method: 'POST',
    path: '/api/admin/rollback',
    auth: 'admin',
    body: ActivationBody,
    response: ActivationResponse,
  },
  /** Resolved funnel for in-memory preview: creates no session and no events (11.1). */
  previewVersion: {
    method: 'GET',
    path: '/api/admin/versions/:v/preview',
    auth: 'admin',
    params: VersionParams,
    query: z.object({ variant: Variant.default('A') }),
    response: z.object({ funnel: ResolvedFunnelSchema }),
  },

  analyticsFilters: {
    method: 'GET',
    path: '/api/analytics/filters',
    auth: 'admin',
    response: z.object({
      versions: z.array(z.object({ version: z.number().int().positive(), active: z.boolean() })),
      campaigns: z.array(z.string()),
      sources: z.array(z.string()),
    }),
  },
  analyticsSummary: {
    method: 'GET',
    path: '/api/analytics/summary',
    auth: 'admin',
    query: AnalyticsFiltersSchema,
    response: AnalyticsSummarySchema,
  },
} as const satisfies Record<string, RouteDef>;

/** Server-sent events stream of ingest results; every `data:` line is a LiveEntry. */
export const LIVE_STREAM = { path: '/api/live', auth: 'admin', backlog: 50 } as const;
