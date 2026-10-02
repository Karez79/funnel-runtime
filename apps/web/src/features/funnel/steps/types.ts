import type { AnswerValue, Step } from '@funnel/shared';

/** Everything a step component gets (CLAUDE.md 8.2); it knows nothing about the funnel. */
export interface StepProps<S extends Step = Step> {
  readonly step: S;
  readonly value: AnswerValue | undefined;
  readonly onChange: (value: AnswerValue | undefined) => void;
  readonly error: string | null;
}
