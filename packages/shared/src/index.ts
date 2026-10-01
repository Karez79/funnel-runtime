// Public entry of @funnel/shared. Everything else in src/ is internal (CLAUDE.md 3.1).
export { contract } from './api/contract.ts';
export type { HealthResponse, RouteDef } from './api/contract.ts';
export { codeForStatus, DomainError, ErrorBody } from './api/errors.ts';
export type { ErrorCode } from './api/errors.ts';

export {
  answerKey,
  isInteractive,
  isKnownStep,
  KNOWN_OPERATORS,
  KNOWN_STEP_TYPES,
  parseConfig,
  VARIANTS,
} from './config/schema.ts';
export type {
  Condition,
  ConditionLeaf,
  EventDefinition,
  FunnelConfig,
  InteractiveStep,
  KnownStep,
  MultiSelectStep,
  NumberStep,
  Option,
  ParseConfigResult,
  Result,
  ResultRule,
  SingleSelectStep,
  Step,
  VariantKey,
} from './config/schema.ts';

export { AnswerValueSchema, conditionAnswers, evaluateCondition } from './engine/conditions.ts';
export type { Answers, AnswerValue, EvaluateOptions } from './engine/conditions.ts';

export { ResolvedFunnelSchema, resolveFunnel } from './engine/resolve.ts';
export type { ResolvedFunnel } from './engine/resolve.ts';

export {
  effectiveAnswers,
  nextStep,
  progress,
  stepBack,
  visiblePath,
} from './engine/navigation.ts';
export type { Progress } from './engine/navigation.ts';

export { validateAnswer, validateCompletion } from './engine/validation.ts';
export type { CompletionResult, ValidationCode, ValidationResult } from './engine/validation.ts';

export { computeResult } from './engine/result.ts';

export { lintConfig } from './config/lint.ts';
export type { LintContext, LintErrorCode, LintReport, LintWarningCode } from './config/lint.ts';

export { diffConfigs } from './config/diff.ts';
export type { ChangeKind, ConfigChange } from './config/diff.ts';

export {
  BatchEnvelopeSchema,
  BatchResponseSchema,
  ClientEventSchema,
  MAX_BATCH_EVENTS,
  REJECT_REASONS,
} from './events/schema.ts';
export type { ClientEvent, EventProperties } from './events/schema.ts';
export { BASE_EVENTS, catalogEvent, filterProperties, isServerOnly } from './events/catalog.ts';
export { answerKind, isAnswerKind } from './events/answerKind.ts';

export {
  GENERATOR_KEY_HEADER,
  LIVE_STREAM,
  LiveEntrySchema,
  SessionStateSchema,
  SessionUnprocessableDetailsSchema,
  StateConflictDetailsSchema,
} from './api/contract.ts';
export type { LiveEntry, SessionResponse, SessionState, VersionSummary } from './api/contract.ts';
export {
  AnalyticsFiltersSchema,
  AnalyticsSummarySchema,
  VariantFilterSchema,
} from './analytics/summary.ts';
export type { AnalyticsFilters, AnalyticsSummary } from './analytics/summary.ts';
export { ConfigChangeSchema } from './config/diff.ts';
export { LintReportSchema } from './config/lint.ts';

export {
  ACTIVATION_ACTIONS,
  TRAFFIC_TYPES,
  VARIANT_SOURCES,
  VERSION_STATES,
} from './api/domain.ts';
