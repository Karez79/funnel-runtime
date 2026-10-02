// Public entry of @funnel/shared. Everything else in src/ is internal (CLAUDE.md 3.1).
export { contract } from './api/contract.ts';
export type { HealthResponse, RouteDef } from './api/contract.ts';
export { codeForStatus, DomainError, ErrorBody } from './api/errors.ts';
export type { ErrorCode } from './api/errors.ts';

export { answerKey, isInteractive, isKnownStep, parseConfig, VARIANTS } from './config/schema.ts';
export type {
  EventDefinition,
  FunnelConfig,
  InteractiveStep,
  MultiSelectStep,
  NumberStep,
  Result,
  SingleSelectStep,
  Step,
  VariantKey,
} from './config/schema.ts';

export type { Answers, AnswerValue } from './engine/conditions.ts';

export { resolveFunnel } from './engine/resolve.ts';
export type { ResolvedFunnel } from './engine/resolve.ts';

export { nextStep, progress, stepBack, visiblePath } from './engine/navigation.ts';
export type { Progress } from './engine/navigation.ts';

export { validateAnswer, validateCompletion } from './engine/validation.ts';

export { computeResult } from './engine/result.ts';

export { lintConfig } from './config/lint.ts';
export type { LintErrorCode, LintReport } from './config/lint.ts';

export { diffConfigs } from './config/diff.ts';
export type { ConfigChange } from './config/diff.ts';

export {
  BatchResponseSchema,
  ClientEventSchema,
  MAX_BATCH_EVENTS,
  REJECT_REASONS,
} from './events/schema.ts';
export type { ClientEvent, EventProperties } from './events/schema.ts';
export { catalogEvent, filterProperties, isServerOnly } from './events/catalog.ts';
export { answerKind } from './events/answerKind.ts';

export {
  GENERATOR_KEY_HEADER,
  LIVE_STREAM,
  LiveEntrySchema,
  SessionStateSchema,
  SessionUnprocessableDetailsSchema,
} from './api/contract.ts';
export type {
  LiveEntry,
  LiveEntryDraft,
  SessionResponse,
  SessionState,
  VersionSummary,
} from './api/contract.ts';
export {
  AnalyticsFiltersSchema,
  AnalyticsSummarySchema,
  VariantFilterSchema,
} from './analytics/summary.ts';
export type { AnalyticsFilters, AnalyticsSummary } from './analytics/summary.ts';

export {
  ACTIVATION_ACTIONS,
  TRAFFIC_TYPES,
  VARIANT_SOURCES,
  VERSION_STATES,
} from './api/domain.ts';

export { aggregate } from './analytics/aggregate.ts';
export { compareSummaries, coversSessions, GroundTruthSchema } from './analytics/groundTruth.ts';
export type { GroundTruth } from './analytics/groundTruth.ts';
export type {
  AnalyticsEvent,
  AnalyticsSession,
  AnalyticsVersion,
  IngestQuality,
} from './analytics/aggregate.ts';
