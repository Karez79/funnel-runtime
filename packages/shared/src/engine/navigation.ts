// Navigation over a resolved funnel (CLAUDE.md 4.4). The visible path is recomputed from
// the answers every time, because one answer can open or hide later steps. The walk
// follows the sequence and only lets answers of steps already found visible feed later
// conditions: an answer left over on a step that became hidden counts as missing.
// Such answers stay in the session state (the user may switch back) but never reach
// conditions, validation of completeness or the result (`effectiveAnswers`).
// Back uses the history stack, not the visible path, so changing an answer that
// reshapes the path never sends the user somewhere they have not been.
import { answerKey, isInteractive, isKnownStep } from '../config/schema.ts';
import {
  evaluateCondition,
  type Answers,
  type AnswerValue,
  type EvaluateOptions,
} from './conditions.ts';
import type { ResolvedFunnel } from './resolve.ts';

interface Walk {
  readonly path: string[];
  readonly answers: Answers;
}

function walk(resolved: ResolvedFunnel, answers: Answers, options: EvaluateOptions): Walk {
  const path: string[] = [];
  const visible: Record<string, AnswerValue> = {};
  for (const id of resolved.sequence) {
    const step = resolved.steps[id];
    if (!step) continue;
    if (step.visibleWhen && !evaluateCondition(step.visibleWhen, visible, options)) continue;
    path.push(id);
    if (!isInteractive(step)) continue;
    const key = answerKey(step);
    const value = answers[key];
    if (value !== undefined) visible[key] = value;
  }
  return { path, answers: visible };
}

export function visiblePath(
  resolved: ResolvedFunnel,
  answers: Answers,
  options: EvaluateOptions = {},
): string[] {
  return walk(resolved, answers, options).path;
}

/** Only answers of visible steps: the input for results and completeness checks. */
export function effectiveAnswers(
  resolved: ResolvedFunnel,
  answers: Answers,
  options: EvaluateOptions = {},
): Answers {
  return walk(resolved, answers, options).answers;
}

/**
 * The visible step after `currentId`. A current step that has just become hidden still
 * has its place in the sequence, so the user moves on from there instead of jumping back.
 */
export function nextStep(
  resolved: ResolvedFunnel,
  answers: Answers,
  currentId: string,
  options: EvaluateOptions = {},
): string | null {
  const position = resolved.sequence.indexOf(currentId);
  if (position === -1) return null;
  const path = new Set(visiblePath(resolved, answers, options));
  return resolved.sequence.slice(position + 1).find((id) => path.has(id)) ?? null;
}

export interface Progress {
  /** Counted steps up to and including the current one (0 on the intro). */
  readonly index: number;
  readonly total: number;
}

/**
 * Counts visible steps of known types that are not in `progress.excludeTypes`. The index
 * goes by sequence position, so a current step that is hidden or not counted itself
 * (stale state, unknown type) shows the count reached so far instead of dropping to 0.
 */
export function progress(
  resolved: ResolvedFunnel,
  answers: Answers,
  currentId: string,
  options: EvaluateOptions = {},
): Progress {
  const excluded = new Set(resolved.meta.progressExcludeTypes);
  const counted = visiblePath(resolved, answers, options).filter((id) => {
    const step = resolved.steps[id];
    return step !== undefined && isKnownStep(step) && !excluded.has(step.type);
  });
  const position = resolved.sequence.indexOf(currentId);
  const index = counted.filter((id) => resolved.sequence.indexOf(id) <= position).length;
  return { index, total: counted.length };
}

/** Pops the history stack; `null` when there is nowhere to go back to. */
export function stepBack(history: readonly string[]): { stepId: string; history: string[] } | null {
  const stepId = history.at(-1);
  return stepId === undefined ? null : { stepId, history: history.slice(0, -1) };
}
