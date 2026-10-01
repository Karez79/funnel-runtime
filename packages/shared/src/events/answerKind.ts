// The only trace of an answer that reaches events (CLAUDE.md 7.2): its shape, never its
// value. Branches are visible in analytics through `step_viewed` of conditional steps.
import type { Step } from '../config/schema.ts';

export function answerKind(step: Step, value: unknown): string | null {
  switch (step.type) {
    case 'single-select':
      return 'single_select';
    case 'multi-select':
      return `multi_select:${String(Array.isArray(value) ? value.length : 0)}`;
    case 'number':
      return 'number';
    default:
      return null;
  }
}
