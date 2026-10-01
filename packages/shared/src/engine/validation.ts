// Answer validation (CLAUDE.md 4.5), shared by the client (live errors) and the server
// (state and completion checks, the source of truth). Values come from JSON, so they are
// typed `unknown` and checked here; a value of the wrong shape gets its own code
// `invalidType` (not in the spec list, see DECISIONS.md) instead of passing as "missing".
// Messages come from `validation.messages` of the step, with English defaults.
import { answerKey, isInteractive, type InteractiveStep, type Step } from '../config/schema.ts';
import { effectiveAnswers, visiblePath } from './navigation.ts';
import type { Answers, EvaluateOptions } from './conditions.ts';
import type { ResolvedFunnel } from './resolve.ts';

export type ValidationCode =
  | 'required'
  | 'min'
  | 'max'
  | 'minSelections'
  | 'maxSelections'
  | 'integer'
  | 'invalidOption'
  | 'invalidType';

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ValidationCode; readonly message: string };

const OK: ValidationResult = { ok: true };

const DEFAULT_MESSAGES: Readonly<Record<ValidationCode, string>> = {
  required: 'This field is required.',
  min: 'Enter a larger value.',
  max: 'Enter a smaller value.',
  integer: 'Enter a whole number.',
  minSelections: 'Choose more options.',
  maxSelections: 'Choose fewer options.',
  invalidOption: 'Choose one of the listed options.',
  invalidType: 'Enter a valid answer.',
};

/** `fallback` replaces the generic default when the limit is known at the call site. */
function fail(step: InteractiveStep, code: ValidationCode, fallback?: string): ValidationResult {
  return {
    ok: false,
    code,
    message: step.validation?.messages?.[code] ?? fallback ?? DEFAULT_MESSAGES[code],
  };
}

function validateNumber(step: InteractiveStep & { type: 'number' }, value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(step, 'invalidType');
  const { min, max, step: increment } = step.input;
  if (increment === 1 && !Number.isInteger(value)) return fail(step, 'integer');
  if (min !== undefined && value < min) {
    return fail(step, 'min', `Enter a value of at least ${String(min)}.`);
  }
  if (max !== undefined && value > max) {
    return fail(step, 'max', `Enter a value of at most ${String(max)}.`);
  }
  return OK;
}

function validateMulti(step: InteractiveStep & { type: 'multi-select' }, value: unknown) {
  if (!Array.isArray(value)) return fail(step, 'invalidType');
  const options = new Set(step.input.options.map((o) => o.value));
  const unique = new Set(value);
  if (
    unique.size !== value.length ||
    !value.every((v) => typeof v === 'string' && options.has(v))
  ) {
    return fail(step, 'invalidOption');
  }
  const { minSelections, maxSelections } = step.validation ?? {};
  if (minSelections !== undefined && value.length < minSelections) {
    return fail(step, 'minSelections', `Choose at least ${String(minSelections)}.`);
  }
  if (maxSelections !== undefined && value.length > maxSelections) {
    return fail(step, 'maxSelections', `Choose no more than ${String(maxSelections)}.`);
  }
  return OK;
}

export function validateAnswer(step: Step, value: unknown): ValidationResult {
  if (!isInteractive(step)) return OK;
  const empty = value === undefined || (Array.isArray(value) && value.length === 0);
  if (empty) {
    const minSelections = step.type === 'multi-select' ? (step.validation?.minSelections ?? 0) : 0;
    if (minSelections > 0) {
      return fail(step, 'minSelections', `Choose at least ${String(minSelections)}.`);
    }
    return step.validation?.required ? fail(step, 'required') : OK;
  }
  switch (step.type) {
    case 'number':
      return validateNumber(step, value);
    case 'multi-select':
      return validateMulti(step, value);
    case 'single-select':
      if (typeof value !== 'string') return fail(step, 'invalidType');
      return step.input.options.some((o) => o.value === value) ? OK : fail(step, 'invalidOption');
  }
}

export type CompletionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly stepId: string;
      readonly code: ValidationCode;
      readonly message: string;
    };

/** Every visible interactive step has a valid answer; hidden steps and their answers are ignored. */
export function validateCompletion(
  resolved: ResolvedFunnel,
  answers: Answers,
  options: EvaluateOptions = {},
): CompletionResult {
  const effective = effectiveAnswers(resolved, answers, options);
  for (const id of visiblePath(resolved, answers, options)) {
    const step = resolved.steps[id];
    if (!step || !isInteractive(step)) continue;
    const result = validateAnswer(step, effective[answerKey(step)]);
    if (!result.ok) return { ...result, stepId: id };
  }
  return { ok: true };
}
