// Condition evaluation (CLAUDE.md 4.2) for `visibleWhen` and `resultRules`. Pure: the
// caller decides which answers count (navigation passes only answers of visible steps),
// so "the answer belongs to a hidden step" and "there is no answer" are the same case
// here: the leaf is false, and only `not` above it can turn that into true.
// An unknown operator is rejected by lint before publishing; at runtime it evaluates to
// false and is reported through `warn`, because the engine itself does no I/O.
import { z } from 'zod';
import type { Condition, ConditionLeaf } from '../config/schema.ts';

export const AnswerValueSchema = z.union([z.string(), z.number(), z.array(z.string())]);
export type AnswerValue = z.infer<typeof AnswerValueSchema>;
/** Answers keyed by `answerKey(step)` (= `input.name`). */
export type Answers = Readonly<Record<string, AnswerValue>>;

export interface EvaluateOptions {
  readonly warn?: (message: string) => void;
}

type Present = (answer: AnswerValue, value: unknown) => boolean;

const compare =
  (test: (a: number, b: number) => boolean): Present =>
  (answer, value) =>
    typeof answer === 'number' && typeof value === 'number' && test(answer, value);

const PRESENT_OPERATORS: Readonly<Record<string, Present>> = {
  eq: (answer, value) => answer === value,
  ne: (answer, value) => answer !== value,
  in: (answer, value) => Array.isArray(value) && value.includes(answer),
  not_in: (answer, value) => Array.isArray(value) && !value.includes(answer),
  gt: compare((a, b) => a > b),
  gte: compare((a, b) => a >= b),
  lt: compare((a, b) => a < b),
  lte: compare((a, b) => a <= b),
  contains: (answer, value) => {
    if (!Array.isArray(answer)) return false;
    const wanted: unknown[] = Array.isArray(value) ? value : [value];
    return wanted.every((v) => typeof v === 'string' && answer.includes(v));
  },
};

function evaluateLeaf(leaf: ConditionLeaf, answers: Answers, options: EvaluateOptions): boolean {
  const answer = answers[leaf.answer];
  if (leaf.operator === 'exists') {
    return leaf.value === false ? answer === undefined : answer !== undefined;
  }
  const op = PRESENT_OPERATORS[leaf.operator];
  if (!op) {
    options.warn?.(`unknown condition operator "${leaf.operator}" treated as false`);
    return false;
  }
  return answer !== undefined && op(answer, leaf.value);
}

export function evaluateCondition(
  condition: Condition,
  answers: Answers,
  options: EvaluateOptions = {},
): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluateCondition(c, answers, options));
  if ('any' in condition) return condition.any.some((c) => evaluateCondition(c, answers, options));
  if ('not' in condition) return !evaluateCondition(condition.not, answers, options);
  return evaluateLeaf(condition, answers, options);
}

/** Answer keys a condition depends on, deduplicated in first-seen order (lint, branch split). */
export function conditionAnswers(condition: Condition): string[] {
  const keys = new Set<string>();
  const walk = (c: Condition): void => {
    if ('all' in c) c.all.forEach(walk);
    else if ('any' in c) c.any.forEach(walk);
    else if ('not' in c) walk(c.not);
    else keys.add(c.answer);
  };
  walk(condition);
  return [...keys];
}
