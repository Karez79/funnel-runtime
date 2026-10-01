// Public entry of @funnel/shared. Everything else in src/ is internal (CLAUDE.md 3.1).
export { contract } from './api/contract.ts';
export type { HealthResponse, RouteDef } from './api/contract.ts';
export { DomainError, ErrorBody } from './api/errors.ts';
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

export { resolveFunnel } from './engine/resolve.ts';
export type { ResolvedFunnel } from './engine/resolve.ts';
