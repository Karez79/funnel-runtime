// The result screen (CLAUDE.md 8.2, 8.3). The result comes from the server (live) or from
// the engine (preview); this component only renders an outcome: loading and error states
// use the titles of the result step from the config. The CTA with
// `action: expand_recommendation` opens a 30-day plan built from the recommendations
// (`grid-template-rows: 0fr → 1fr`, no height measured in JS).
import { EXPAND_RECOMMENDATION, type Result, type Step } from '@funnel/shared';
import { useEffect, useEffectEvent, useId, useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import styles from './ResultScreen.module.css';
import { ResultWeek } from './ResultWeek.tsx';
import type { Track } from './tracking.ts';

export type ResultOutcome =
  | { readonly status: 'pending' }
  | { readonly status: 'error'; readonly retry: () => void }
  | { readonly status: 'ready'; readonly resultId: string; readonly result: Result };

const WEEKS_IN_PLAN = 4;

/** Recommendations spread over four weeks, in order; UI adds only the week labels. */
function planWeeks(recommendations: readonly string[]): string[][] {
  const weeks: string[][] = [];
  recommendations.forEach((text, i) => {
    const week = Math.min(i, WEEKS_IN_PLAN - 1);
    (weeks[week] ??= []).push(text);
  });
  return weeks;
}

function ReadyResult({
  resultId,
  result,
  track,
}: {
  resultId: string;
  result: Result;
  track: Track;
}) {
  const [open, setOpen] = useState(false);
  const planId = useId();
  const expands = result.cta.action === EXPAND_RECOMMENDATION.action;

  const onShown = useEffectEvent(() => {
    track('result_viewed', 'result', { result_id: resultId });
  });
  useEffect(() => {
    onShown();
  }, [resultId]);

  return (
    <>
      <span className={styles.kicker}>Your recommendation</span>
      <h1 className={styles.title}>{result.title}</h1>
      <p className={styles.summary}>{result.summary}</p>
      <ResultWeek resultId={resultId} title="What a week could look like" />
      <ul className={styles.recs}>
        {result.recommendations.map((text) => (
          <li key={text}>
            <span className={styles.recIcon} aria-hidden="true">
              <Icon name="check" />
            </span>
            {text}
          </li>
        ))}
      </ul>
      <Button
        aria-expanded={expands ? open : undefined}
        aria-controls={expands ? planId : undefined}
        onClick={() => {
          track('cta_clicked', 'result', { result_id: resultId, action: result.cta.action });
          if (!expands) return;
          // Sent only if the session's catalog lists it (track checks); the values are
          // the CTA's own plus where the plan was opened from (`source`, whitelisted by
          // the v3 catalog): the result CTA is the only place that opens it.
          if (!open) {
            track('recommendation_expanded', 'result', {
              result_id: resultId,
              action: result.cta.action,
              source: EXPAND_RECOMMENDATION.source,
            });
          }
          setOpen(!open);
        }}
      >
        {result.cta.label}
      </Button>
      {expands && (
        <div className={styles.plan} id={planId} data-open={open}>
          {/* Closed, the plan is out of the accessibility tree and the tab order. */}
          <div inert={!open}>
            <ol className={styles.planList} aria-label="30-day plan">
              {planWeeks(result.recommendations).map((items, week) => (
                <li key={week}>
                  <strong>Week {week + 1}</strong>
                  {items.map((text) => (
                    <span key={text}>{text}</span>
                  ))}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </>
  );
}

export function ResultScreen({
  step,
  outcome,
  track,
}: {
  step: Step;
  outcome: ResultOutcome;
  track: Track;
}) {
  const { loadingTitle, errorTitle, retryLabel } = step.content;
  switch (outcome.status) {
    case 'pending':
      return (
        <h1 className={styles.title} aria-busy="true">
          {loadingTitle}
        </h1>
      );
    case 'error':
      return (
        <div role="alert">
          <h1 className={styles.title}>{errorTitle}</h1>
          <Button onClick={outcome.retry}>{retryLabel}</Button>
        </div>
      );
    case 'ready':
      return <ReadyResult resultId={outcome.resultId} result={outcome.result} track={track} />;
  }
}
