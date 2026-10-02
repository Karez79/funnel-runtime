// The funnel card (CLAUDE.md 8.2, 10): back button and progress on top, the current step
// from the registry, Continue. Shared by the live funnel and the admin preview; what
// happens on a move (save, URL, events) is decided by whoever owns the state.
// Keyboard: Enter continues, Esc or Alt+← goes back, digits are handled by choice steps.
import { isInteractive } from '@funnel/shared';
import type { ReactNode } from 'react';
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { IconButton } from '../../ui/IconButton.tsx';
import { Kbd } from '../../ui/Kbd.tsx';
import {
  currentStep,
  hasValue,
  progressOf,
  stepError,
  viewEvent,
  type FunnelAction,
  type FunnelState,
} from './funnelReducer.ts';
import styles from './FunnelPage.module.css';
import { Progress } from './Progress.tsx';
import { StepBody } from './steps/StepBody.tsx';
import { UnknownStep } from './steps/UnknownStep.tsx';
import type { Track } from './tracking.ts';
import { useDocumentKeydown } from '../../lib/useDocumentKeydown.ts';

const CONTINUE = 'Continue';

interface FunnelViewProps {
  readonly state: FunnelState;
  readonly act: (action: FunnelAction) => void;
  readonly track: Track;
  /** The result screen; rendered when the current step is the result step. */
  readonly result: ReactNode;
  /** Back button, Esc and Alt+←; defaults to a Back action. */
  readonly onBack?: () => void;
}

function KeyHint({ step }: { step: ReturnType<typeof currentStep> }) {
  if (!step || !isInteractive(step)) return null;
  const choices = step.type === 'number' ? 0 : Math.min(step.input.options.length, 9);
  return (
    <span className={styles.hint}>
      {choices > 0 && (
        <>
          <Kbd>1</Kbd>–<Kbd>{choices}</Kbd> to choose,{' '}
        </>
      )}
      <Kbd>Enter</Kbd> to continue
    </span>
  );
}

export function FunnelView({ state, act, track, result, onBack }: FunnelViewProps) {
  const back =
    onBack ??
    (() => {
      act({ type: 'back' });
    });
  const step = currentStep(state);
  const isResult = step?.type === 'result';
  const canGoBack = state.history.length > 0;

  // Every render of a step counts as a view, including after Back and after a refresh.
  const onView = useEffectEvent(() => {
    const event = viewEvent(state);
    if (event) track(event.name, event.stepId, event.properties);
  });
  useEffect(() => {
    onView();
  }, [state.currentStepId]);

  // After a move, focus goes to the new step before the next key can arrive (layout
  // effect): screen readers start at its title, and a focused Back button would
  // otherwise take Enter for itself instead of Continue.
  const body = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);
  useLayoutEffect(() => {
    if (!firstStep.current) body.current?.focus({ preventScroll: true });
    firstStep.current = false;
  }, [state.currentStepId]);

  useDocumentKeydown((event: KeyboardEvent) => {
    const { target } = event;
    if (event.key === 'Escape' || (event.altKey && event.key === 'ArrowLeft')) {
      if (!canGoBack) return;
      event.preventDefault();
      back();
      return;
    }
    if (event.key !== 'Enter' || isResult || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    // Other buttons (Back, Continue itself) handle Enter natively; options do not.
    if (target instanceof HTMLButtonElement && !('option' in target.dataset)) return;
    if (target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    act({ type: 'continue' });
  });

  return (
    <Card variant="glass" className={styles.card} data-step={state.currentStepId}>
      <div className={styles.top}>
        <IconButton icon="back" aria-label="Back" disabled={!canGoBack} onClick={back} />
        <Progress value={progressOf(state)} done={isResult} />
      </div>
      <div className={styles.body} key={state.currentStepId} ref={body} tabIndex={-1}>
        {isResult ? (
          result
        ) : (
          <>
            {step ? (
              <StepBody
                step={step}
                value={state.draft}
                error={stepError(state)}
                onChange={(value) => {
                  act({ type: 'change', value });
                }}
              />
            ) : (
              <UnknownStep />
            )}
            <div className={styles.actions}>
              <Button
                disabled={!hasValue(state)}
                onClick={() => {
                  act({ type: 'continue' });
                }}
              >
                {step?.content.primaryActionLabel ?? CONTINUE}
              </Button>
              <KeyHint step={step} />
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
