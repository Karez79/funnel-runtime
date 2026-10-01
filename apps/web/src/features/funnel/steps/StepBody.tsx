// Step registry by `type` (CLAUDE.md 8.2). The screen of a step is chosen here and only
// here; an unknown type gets UnknownStep, never a crash. The result step is rendered by
// the page (it needs the server's result), so it is not part of this registry.
import { isKnownStep } from '@funnel/shared';
import { InfoStep } from './InfoStep.tsx';
import { MultiSelectStep } from './MultiSelectStep.tsx';
import { NumberStep } from './NumberStep.tsx';
import { SingleSelectStep } from './SingleSelectStep.tsx';
import type { StepProps } from './types.ts';
import { UnknownStep } from './UnknownStep.tsx';

export function StepBody(props: StepProps) {
  const { step } = props;
  if (!isKnownStep(step)) return <UnknownStep />;
  switch (step.type) {
    case 'info':
      return <InfoStep step={step} />;
    case 'single-select':
      return <SingleSelectStep {...props} step={step} />;
    case 'multi-select':
      return <MultiSelectStep {...props} step={step} />;
    case 'number':
      return <NumberStep {...props} step={step} />;
    case 'result':
      return null;
  }
}
