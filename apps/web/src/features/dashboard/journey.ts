// Layout of the Funnel journey (CLAUDE.md 10): steps of the shown sequence split into
// white columns of at most three, the result step left out (it is the tile column), and
// the step with the most drop-offs singled out. Pure: numbers in, layout out.
import type { AnalyticsSummary } from '@funnel/shared';

export type JourneyStep = AnalyticsSummary['steps'][number];
export type ShownVariant = 'A' | 'B' | 'all';

export interface JourneyColumn {
  readonly label: string;
  readonly steps: readonly JourneyStep[];
}

const MAX_PER_COLUMN = 3;
const QUESTION_TYPES = new Set(['single-select', 'multi-select', 'number']);

/** "team_size" → "Team size". Step ids are the stable names admins know from the config. */
export function humanize(id: string): string {
  const words = id.replaceAll(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function metricsOf(step: JourneyStep, variant: ShownVariant) {
  return variant === 'all' ? step.metrics.all : step.metrics[variant];
}

export function journeyColumns(steps: readonly JourneyStep[]): JourneyColumn[] {
  const shown = steps.filter((s) => s.type !== 'result');
  const count = Math.ceil(shown.length / MAX_PER_COLUMN);
  const columns: JourneyColumn[] = [];
  let question = 0;
  let start = 0;
  for (let c = 0; c < count; c += 1) {
    // Even split: earlier columns take the remainder, so 8 steps become 3 + 3 + 2.
    const size = Math.ceil((shown.length - start) / (count - c));
    const chunk = shown.slice(start, start + size);
    start += size;
    const questions = chunk.filter((s) => QUESTION_TYPES.has(s.type)).length;
    const first = question + 1;
    question += questions;
    const label =
      c === 0
        ? 'Start'
        : questions === 0
          ? 'More steps'
          : first === question
            ? `Question ${String(first)}`
            : `Questions ${String(first)}–${String(question)}`;
    columns.push({ label, steps: chunk });
  }
  return columns;
}

/** The step where the most sessions left (the "current" bold step of the reference). */
export function biggestDrop(steps: readonly JourneyStep[], variant: ShownVariant): string | null {
  let best: { id: string; dropped: number } | null = null;
  for (const step of steps) {
    const dropped = metricsOf(step, variant)?.droppedHere ?? 0;
    if (dropped > 0 && (best === null || dropped > best.dropped)) {
      best = { id: step.stepId, dropped };
    }
  }
  return best?.id ?? null;
}
