// The only trace of an answer that reaches events (CLAUDE.md 7.2): its shape, never its
// value. Branches are visible in analytics through `step_viewed` of conditional steps.
// The kinds are defined here once; ingest checks incoming values with `isAnswerKind`.
import type { Step } from '../config/schema.ts';

const SINGLE = 'single_select';
const MULTI_PREFIX = 'multi_select:';
const NUMBER = 'number';

export function answerKind(step: Step, value: unknown): string | null {
  switch (step.type) {
    case 'single-select':
      return SINGLE;
    case 'multi-select':
      return `${MULTI_PREFIX}${String(Array.isArray(value) ? value.length : 0)}`;
    case 'number':
      return NUMBER;
    default:
      return null;
  }
}

/** True only for a value `answerKind` can produce. */
export function isAnswerKind(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value === SINGLE || value === NUMBER) return true;
  return value.startsWith(MULTI_PREFIX) && /^\d+$/.test(value.slice(MULTI_PREFIX.length));
}
