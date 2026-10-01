// Result computation (CLAUDE.md 4.6): the first rule whose condition holds wins,
// otherwise the default. Conditions see only `effectiveAnswers`, so a stale answer on a
// step the user no longer sees cannot pick the result. The server is the source of truth
// (it stores `result_id` on complete); the client runs the same function only to render
// optimistically.
import { evaluateCondition, type Answers, type EvaluateOptions } from './conditions.ts';
import { effectiveAnswers } from './navigation.ts';
import type { ResolvedFunnel } from './resolve.ts';

export function computeResult(
  resolved: ResolvedFunnel,
  answers: Answers,
  options: EvaluateOptions = {},
): string {
  const effective = effectiveAnswers(resolved, answers, options);
  const rule = resolved.resultRules.find((r) => evaluateCondition(r.when, effective, options));
  return rule?.resultId ?? resolved.defaultResultId;
}
